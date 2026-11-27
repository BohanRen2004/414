import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cloud function against a fake wx-server-sdk database with the real update semantics that matter:
 * a plain object in an update is merged into the stored field, `_.set` replaces it.
 */
const fake = vi.hoisted(() => {
  type Doc = Record<string, unknown>;
  const collections = new Map<string, Map<string, Doc>>();
  let openid = 'host';
  const SET = Symbol('set');
  const NEQ = Symbol('neq');

  function table(name: string): Map<string, Doc> {
    const found = collections.get(name);
    if (found === undefined) throw Object.assign(new Error(`collection ${name} does not exist`), { errCode: -502005 });
    return found;
  }

  function matches(doc: Doc, condition: Record<string, unknown>): boolean {
    return Object.entries(condition).every(([key, expected]) => {
      if (typeof expected === 'object' && expected !== null && NEQ in expected) return doc[key] !== (expected as Record<symbol, unknown>)[NEQ];
      return doc[key] === expected;
    });
  }

  function merge(target: unknown, patch: unknown): unknown {
    if (typeof patch === 'object' && patch !== null && SET in patch) return structuredClone((patch as Record<symbol, unknown>)[SET]);
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch) || typeof target !== 'object' || target === null) return structuredClone(patch);
    const result: Doc = { ...(target as Doc) };
    for (const [key, value] of Object.entries(patch)) result[key] = merge(result[key], value);
    return result;
  }

  function query(name: string, condition: Record<string, unknown> = {}, order?: [string, 'asc' | 'desc'], count = 100) {
    return {
      where: (next: Record<string, unknown>) => query(name, next, order, count),
      orderBy: (field: string, direction: 'asc' | 'desc') => query(name, condition, [field, direction], count),
      limit: (next: number) => query(name, condition, order, next),
      async get() {
        let docs = [...table(name).values()].filter((doc) => matches(doc, condition));
        if (order !== undefined) {
          const [field, direction] = order;
          docs = docs.sort((a, b) => (Number(a[field]) - Number(b[field])) * (direction === 'asc' ? 1 : -1));
        }
        return { data: structuredClone(docs.slice(0, count)) };
      },
      async update({ data }: { data: Doc }) {
        let updated = 0;
        for (const [id, doc] of table(name)) {
          if (!matches(doc, condition)) continue;
          table(name).set(id, merge(doc, data) as Doc);
          updated += 1;
        }
        return { stats: { updated } };
      },
    };
  }

  const db = {
    command: {
      neq: (value: unknown) => ({ [NEQ]: value }),
      set: (value: unknown) => ({ [SET]: value }),
    },
    collection: (name: string) => ({
      ...query(name),
      doc: (id: string) => ({
        async get() {
          const doc = table(name).get(id);
          if (doc === undefined) throw new Error('document does not exist');
          return { data: structuredClone(doc) };
        },
        async set({ data }: { data: Doc }) {
          table(name).set(id, { ...structuredClone(data), _id: id });
        },
      }),
      async add({ data }: { data: Doc }) {
        const id = String(data._id);
        if (table(name).has(id)) throw new Error('duplicate _id');
        table(name).set(id, structuredClone(data));
        return { _id: id };
      },
    }),
    async createCollection(name: string) {
      if (collections.has(name)) throw new Error('collection exists');
      collections.set(name, new Map());
    },
  };

  return {
    collections,
    setOpenid: (next: string) => { openid = next; },
    module: {
      DYNAMIC_CURRENT_ENV: Symbol('env'),
      init: () => {},
      database: () => db,
      getWXContext: () => ({ OPENID: openid, APPID: 'test' }),
    },
  };
});

vi.mock('wx-server-sdk', () => fake.module);

const { main } = await import('../../server/cloud/room-function');

async function call(openid: string, event: unknown): Promise<Record<string, any>> {
  fake.setOpenid(openid);
  return JSON.parse(JSON.stringify(await main(JSON.parse(JSON.stringify(event))))) as Record<string, any>;
}

describe('room cloud function', () => {
  beforeEach(() => fake.collections.clear());

  it('creates the collections and runs a room from the lobby into a game', async () => {
    const created = await call('host', { type: 'create', nickname: '房主', deckCount: 1 });
    expect(created.ok).toBe(true);
    expect([...fake.collections.keys()].sort()).toEqual(['inbox', 'rooms']);
    const { roomId, code } = created.room;

    const joined = await call('amy', { type: 'join', code, nickname: 'amy' });
    expect(joined.room.mySeat).toBe(1);
    // Moving seats empties seat 1 and bumps the revision the next write must match.
    await call('amy', { type: 'seat', roomId, seat: 3 });
    const stored = fake.collections.get('rooms')!.get(roomId)!;
    expect((stored.seats as unknown[])[1]).toBeNull();
    expect(stored.revision).toBe(2);

    // The host hears about Amy through the inbox, which only the host may read.
    expect(fake.collections.get('inbox')!.get('host')).toMatchObject({ _openid: 'host', roomId });

    const started = await call('host', { type: 'start', roomId, cursor: null });
    expect(started.game.gameNo).toBe(1);
    expect(started.game.frames.length).toBeGreaterThan(0);
    expect(fake.collections.get('rooms')!.get(roomId)!.status).toBe('playing');

    expect(await call('eve', { type: 'sync', roomId })).toEqual({ ok: false, code: 'NOT_IN_ROOM' });
    expect(await call('eve', { bogus: true })).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });
});
