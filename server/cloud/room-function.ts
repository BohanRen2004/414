import { randomBytes } from 'crypto';
import * as cloud from 'wx-server-sdk';
import { RoomRecord } from '../room/engine';
import { RoomStore, handleRoomRequest } from '../room/handler';

/**
 * The `room` cloud function: every room request goes through here. The caller's identity comes from the
 * WeChat context, never from the request. Rooms (seed and action log included) live in the `rooms`
 * collection, which clients must not be able to read; each player's `inbox` doc only says "sync now".
 */

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ROOMS = 'rooms';
const INBOX = 'inbox';

let collectionsReady: Promise<void> | null = null;

/** Create the collections on first use; creating one that exists fails harmlessly. */
function ensureCollections(): Promise<void> {
  collectionsReady ??= Promise.all([ROOMS, INBOX].map((name) => db.createCollection(name).catch(() => undefined))).then(() => undefined);
  return collectionsReady;
}

function toRecord(data: Record<string, unknown>): RoomRecord {
  const { _id, ...rest } = data;
  return { ...(rest as unknown as Omit<RoomRecord, 'id'>), id: String(_id) };
}

function toDocument(room: RoomRecord): Record<string, unknown> {
  const { id: _ignored, ...rest } = room;
  return rest as unknown as Record<string, unknown>;
}

const store: RoomStore = {
  async get(id) {
    try {
      return toRecord((await db.collection(ROOMS).doc(id).get()).data);
    } catch {
      return null;
    }
  },
  async findOpenByCode(code) {
    const result = await db.collection(ROOMS).where({ code, status: _.neq('closed') }).orderBy('updatedAt', 'desc').limit(1).get();
    const found = result.data[0];
    return found === undefined ? null : toRecord(found);
  },
  async insert(room) {
    await db.collection(ROOMS).add({ data: { _id: room.id, ...toDocument(room) } });
  },
  async replace(room, expectedRevision) {
    // `_.set` replaces a whole field; a plain object would be merged into the stored one.
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(toDocument(room))) {
      data[key] = typeof value === 'object' && value !== null ? _.set(value) : value;
    }
    const result = await db.collection(ROOMS).where({ _id: room.id, revision: expectedRevision }).update({ data });
    return result.stats.updated === 1;
  },
  async notify(openids, roomId) {
    const stamp = Date.now();
    await Promise.all(openids.map((openid) => db.collection(INBOX).doc(openid)
      .set({ data: { _openid: openid, roomId, stamp } })
      .catch(() => undefined)));
  },
};

export async function main(event: unknown): Promise<unknown> {
  await ensureCollections();
  const { OPENID } = cloud.getWXContext();
  return handleRoomRequest(store, {
    openid: OPENID,
    now: () => Date.now(),
    randomUint32: () => randomBytes(4).readUInt32LE(0),
  }, event);
}
