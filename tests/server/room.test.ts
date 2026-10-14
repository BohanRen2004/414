import { describe, expect, it } from 'vitest';
import { PlayerId } from '../../client/assets/scripts/core/cards/card';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { RoomResponse, SeatMove, SyncCursor, TURN_TIME_MS, seatMove } from '../../client/assets/scripts/online/protocol';
import { fromWireState } from '../../client/assets/scripts/online/wire';
import { rankedHintActions } from '../../client/assets/scripts/ui/hints';
import { replayGame } from '../../server/room/engine';
import { RequestContext, handleRoomRequest, parseRequest } from '../../server/room/handler';
import { MemoryRoomStore } from '../../server/room/memory-store';

type Ok = Extract<RoomResponse, { ok: true }>;

class Harness {
  public readonly store = new MemoryRoomStore();
  public time = 1_700_000_000_000;
  private counter = 0x1234_5678;

  public context(openid: string): RequestContext {
    return {
      openid,
      now: () => this.time,
      randomUint32: () => {
        // xorshift: deterministic, so a failing run can be reproduced.
        let x = this.counter;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        this.counter = x >>> 0;
        return this.counter;
      },
    };
  }

  public async call(openid: string, request: unknown): Promise<RoomResponse> {
    // Round-trip through JSON like the cloud function boundary does.
    const response = await handleRoomRequest(this.store, this.context(openid), JSON.parse(JSON.stringify(request)));
    return JSON.parse(JSON.stringify(response)) as RoomResponse;
  }

  public async ok(openid: string, request: unknown): Promise<Ok> {
    const response = await this.call(openid, request);
    if (!response.ok) throw new Error(`${JSON.stringify(request)} failed: ${response.code} ${response.ruleCode ?? ''}`);
    return response;
  }

  /** The authoritative game, for assertions only. */
  public authoritative(roomId: string): GameState {
    const game = this.store.rooms.get(roomId)!.game!;
    return replayGame(game).state;
  }
}

/** One client's copy of the game, kept the way the mini game keeps it: frames applied in order. */
class Client {
  public cursor: SyncCursor | null = null;
  public state: GameState | null = null;
  public seat: PlayerId | null = null;
  public readonly seen: string[] = [];

  public constructor(public readonly openid: string) {}

  public absorb(response: Ok): void {
    this.seen.push(JSON.stringify(response));
    this.seat = response.room.mySeat;
    const game = response.game;
    if (game === null || this.seat === null) return;
    if (this.cursor !== null && this.cursor.gameNo === game.gameNo) expect(game.from).toBeGreaterThanOrEqual(Math.min(this.cursor.frames, game.from));
    const last = game.frames[game.frames.length - 1];
    if (last !== undefined) this.state = fromWireState(last.state, this.seat);
    this.cursor = { gameNo: game.gameNo, frames: game.from + game.frames.length };
  }
}

async function setUpRoom(harness: Harness, guests: readonly string[], deckCount: 1 | 2 = 2) {
  const created = await harness.ok('host', { type: 'create', nickname: '房主', deckCount });
  const roomId = created.room.roomId;
  for (const guest of guests) await harness.ok(guest, { type: 'join', code: created.room.code, nickname: guest });
  return { roomId, code: created.room.code };
}

/** Play every human seat with the first hint (or pass / decline) until the round ends. */
async function playOut(harness: Harness, roomId: string, clients: readonly Client[]): Promise<void> {
  for (let turn = 0; turn < 2000; turn += 1) {
    for (const client of clients) client.absorb(await harness.ok(client.openid, { type: 'sync', roomId, cursor: client.cursor }));
    const truth = harness.authoritative(roomId);
    if (truth.phase === 'ROUND_RESULT') return;
    const actor = clients.find((client) => client.seat === truth.currentPlayer);
    expect(actor, 'the game only waits on humans').toBeDefined();
    const state = actor!.state!;
    // The waiting human always sees their own decision, hidden query or not.
    expect(state.currentPlayer).toBe(actor!.seat);
    let move: SeatMove;
    if (state.phase === 'GOUCHA_QUERY') move = { kind: 'DECLINE_GOUCHA' };
    else {
      const best = rankedHintActions(state, actor!.seat!).find((action) => action.kind === 'PLAY_CARDS');
      move = best !== undefined && (state.phase === 'FREE_LEAD' || turn % 3 !== 0) ? seatMove(best) : state.phase === 'RESPONDING' ? { kind: 'PASS' } : seatMove(best!);
    }
    actor!.absorb(await harness.ok(actor!.openid, { type: 'move', roomId, move, cursor: actor!.cursor }));
  }
  throw new Error('round did not finish');
}

describe('room requests', () => {
  it('rejects malformed requests', () => {
    expect(parseRequest(null)).toBeNull();
    expect(parseRequest({ type: 'create', nickname: '', deckCount: 2 })).toBeNull();
    expect(parseRequest({ type: 'create', nickname: 'a', deckCount: 3 })).toBeNull();
    expect(parseRequest({ type: 'join', code: '12ab56', nickname: 'a' })).toBeNull();
    expect(parseRequest({ type: 'move', roomId: 'r', move: { kind: 'PLAY_CARDS', cardIds: 'x' } })).toBeNull();
    expect(parseRequest({ type: 'move', roomId: 'r', move: { kind: 'START_GAME', seed: 1 } })).toBeNull();
    expect(parseRequest({ type: 'seat', roomId: 'r', seat: 4 })).toBeNull();
    expect(parseRequest({ type: 'create', nickname: ' 很长很长很长很长很长很长的名字 ', deckCount: 1 }))
      .toEqual({ type: 'create', nickname: '很长很长很长很长很长很长', deckCount: 1 });
  });

  it('runs the lobby: join, change seats, host-only deck choice and start, room full', async () => {
    const harness = new Harness();
    const { roomId, code } = await setUpRoom(harness, ['amy']);
    let view = (await harness.ok('amy', { type: 'sync', roomId })).room;
    expect(view.mySeat).toBe(1);
    expect(view.isHost).toBe(false);
    expect(view.seats.map((seat) => seat.kind)).toEqual(['human', 'human', 'empty', 'empty']);

    // Amy moves across to be the host's partner.
    view = (await harness.ok('amy', { type: 'seat', roomId, seat: 2 })).room;
    expect(view.mySeat).toBe(2);
    expect((await harness.call('amy', { type: 'seat', roomId, seat: 0 })).ok).toBe(false);
    expect(await harness.call('amy', { type: 'deck', roomId, deckCount: 1 })).toEqual({ ok: false, code: 'NOT_HOST' });
    expect(await harness.call('amy', { type: 'start', roomId })).toEqual({ ok: false, code: 'NOT_HOST' });
    expect((await harness.ok('host', { type: 'deck', roomId, deckCount: 1 })).room.deckCount).toBe(1);

    await harness.ok('bo', { type: 'join', code, nickname: 'bo' });
    await harness.ok('cy', { type: 'join', code, nickname: 'cy' });
    expect(await harness.call('dan', { type: 'join', code, nickname: 'dan' })).toEqual({ ok: false, code: 'ROOM_FULL' });
    expect(await harness.call('dan', { type: 'join', code: '000000', nickname: 'dan' })).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(await harness.call('dan', { type: 'sync', roomId })).toEqual({ ok: false, code: 'NOT_IN_ROOM' });

    // Joining twice keeps the same seat.
    expect((await harness.ok('bo', { type: 'join', code, nickname: 'bo' })).room.mySeat).toBe(1);
    // Everyone else in the room hears about each change.
    expect(harness.store.notifications.filter((note) => note.openid === 'host').length).toBeGreaterThan(0);
  });

  it.each([1, 2] as const)('plays a full %i-deck game with two humans and two AIs without leaking hands', async (deckCount) => {
    const harness = new Harness();
    const { roomId } = await setUpRoom(harness, ['amy'], deckCount);
    await harness.ok('amy', { type: 'seat', roomId, seat: 2 });
    const host = new Client('host');
    const amy = new Client('amy');
    host.absorb(await harness.ok('host', { type: 'start', roomId, cursor: null }));
    expect(harness.store.rooms.get(roomId)!.seats.map((seat) => seat?.kind)).toEqual(['human', 'ai', 'human', 'ai']);

    await playOut(harness, roomId, [host, amy]);
    const truth = harness.authoritative(roomId);
    expect(truth.result).not.toBeNull();

    for (const client of [host, amy]) {
      client.absorb(await harness.ok(client.openid, { type: 'sync', roomId, cursor: client.cursor }));
      expect(client.state!.phase).toBe('ROUND_RESULT');
      expect(client.state!.result).toEqual(truth.result);
      // The seed (which would reveal every deal) only arrives with the result.
      const frames = client.seen.flatMap((text) => (JSON.parse(text) as Ok).game?.frames ?? []);
      expect(frames.filter((frame) => frame.state.phase !== 'ROUND_RESULT').every((frame) => frame.state.rootSeed === null)).toBe(true);
      expect(frames.filter((frame) => frame.state.phase === 'ROUND_RESULT').every((frame) => frame.state.rootSeed === truth.rootSeed)).toBe(true);
    }
  });

  it('keeps a human\'s gou-cha query hidden from the other humans', async () => {
    let queries = 0;
    let chas = 0;
    for (const seedOffset of [1, 2, 3]) {
      const harness = new Harness();
      for (let skip = 0; skip < seedOffset; skip += 1) harness.context('x').randomUint32();
      const { roomId } = await setUpRoom(harness, ['amy', 'bo', 'cy']);
      const clients = ['host', 'amy', 'bo', 'cy'].map((openid) => new Client(openid));
      clients[0]!.absorb(await harness.ok('host', { type: 'start', roomId, cursor: null }));
      for (let turn = 0; turn < 3000; turn += 1) {
        for (const client of clients) client.absorb(await harness.ok(client.openid, { type: 'sync', roomId, cursor: client.cursor }));
        const truth = harness.authoritative(roomId);
        if (truth.phase === 'ROUND_RESULT') break;
        const actor = clients.find((client) => client.seat === truth.currentPlayer)!;
        if (truth.phase === 'GOUCHA_QUERY') {
          queries += 1;
          for (const other of clients) {
            if (other === actor) continue;
            // Nobody else sees a query in progress, or that the asked seat is to act.
            expect(other.state!.phase === 'GOUCHA_QUERY' && other.state!.currentPlayer !== null).toBe(false);
          }
        }
        const state = actor.state!;
        expect(state.currentPlayer).toBe(actor.seat);
        const hints = rankedHintActions(state, actor.seat!);
        let move: SeatMove;
        if (state.phase === 'GOUCHA_QUERY') {
          const add = hints.find((action) => action.kind === 'ADD_GOUCHA');
          move = add !== undefined && turn % 2 === 0 ? seatMove(add) : { kind: 'DECLINE_GOUCHA' };
          if (move.kind === 'ADD_GOUCHA') chas += 1;
        } else {
          const play = hints.find((action) => action.kind === 'PLAY_CARDS');
          move = play !== undefined && (state.phase === 'FREE_LEAD' || turn % 4 !== 0) ? seatMove(play) : state.phase === 'RESPONDING' ? { kind: 'PASS' } : seatMove(play!);
        }
        const before = harness.store.notifications.length;
        const response = await harness.ok(actor.openid, { type: 'move', roomId, move, cursor: actor.cursor });
        actor.absorb(response);
        if (move.kind === 'PLAY_CARDS') {
          // The mover always sees their own play at once.
          expect(actor.state!.publicHistory.some((record) => record.kind === 'PLAY_CARDS' && record.cardIds.join() === move.cardIds.join())).toBe(true);
        }
        // Only seats with something new to show are woken.
        const woken = harness.store.notifications.slice(before).map((note) => note.openid);
        for (const openid of woken) {
          const client = clients.find((candidate) => candidate.openid === openid)!;
          const sync = await harness.ok(openid, { type: 'sync', roomId, cursor: client.cursor });
          expect(sync.game!.frames.length).toBeGreaterThan(0);
          client.absorb(sync);
        }
      }
      expect(harness.authoritative(roomId).phase).toBe('ROUND_RESULT');
    }
    expect(queries).toBeGreaterThan(0);
    expect(chas).toBeGreaterThan(0);
  });

  it('never sends a card another seat still holds', async () => {
    const harness = new Harness();
    const { roomId } = await setUpRoom(harness, ['amy']);
    const host = new Client('host');
    const amy = new Client('amy');
    host.absorb(await harness.ok('host', { type: 'start', roomId, cursor: null }));
    for (let step = 0; step < 40; step += 1) {
      for (const client of [host, amy]) {
        const response = await harness.ok(client.openid, { type: 'sync', roomId, cursor: client.cursor });
        client.absorb(response);
        const truth = harness.authoritative(roomId);
        const text = JSON.stringify(response);
        for (const player of truth.players) {
          if (player.playerId === client.seat) continue;
          for (const card of player.hand) expect(text.includes(`"${card.id}"`), `${card.id} of seat ${player.playerId}`).toBe(false);
        }
      }
      const truth = harness.authoritative(roomId);
      if (truth.phase === 'ROUND_RESULT') break;
      const actor = [host, amy].find((client) => client.seat === truth.currentPlayer)!;
      const state = actor.state!;
      const move: SeatMove = state.phase === 'GOUCHA_QUERY' ? { kind: 'DECLINE_GOUCHA' }
        : state.phase === 'RESPONDING' ? { kind: 'PASS' }
          : seatMove(rankedHintActions(state, actor.seat!)[0]!);
      actor.absorb(await harness.ok(actor.openid, { type: 'move', roomId, move, cursor: actor.cursor }));
    }
  });

  it('rejects a move out of turn and a move by someone outside the room', async () => {
    const harness = new Harness();
    const { roomId } = await setUpRoom(harness, ['amy']);
    await harness.ok('host', { type: 'start', roomId });
    const truth = harness.authoritative(roomId);
    const waiting = truth.currentPlayer === 0 ? 'amy' : 'host';
    const response = await harness.call(waiting, { type: 'move', roomId, move: { kind: 'PASS' } });
    expect(response).toMatchObject({ ok: false, code: 'RULE_REJECTED' });
    expect(await harness.call('eve', { type: 'move', roomId, move: { kind: 'PASS' } })).toEqual({ ok: false, code: 'NOT_IN_ROOM' });
    expect(harness.authoritative(roomId)).toEqual(truth);
  });

  it('lets the AI take over after the time limit, and the player can take the seat back', async () => {
    const harness = new Harness();
    const { roomId } = await setUpRoom(harness, ['amy']);
    await harness.ok('host', { type: 'start', roomId });
    const waitingSeat = harness.authoritative(roomId).currentPlayer!;
    const waiting = waitingSeat === 0 ? 'host' : 'amy';
    const other = waiting === 'host' ? 'amy' : 'host';
    const before = harness.authoritative(roomId).actionNumber;

    const early = await harness.ok(other, { type: 'tick', roomId });
    expect(early.room.seats[waitingSeat]!.auto).toBe(false);
    expect(harness.authoritative(roomId).actionNumber).toBe(before);

    harness.time += TURN_TIME_MS + 1;
    await harness.ok(other, { type: 'tick', roomId });
    expect(harness.authoritative(roomId).actionNumber).toBeGreaterThan(before);
    const mine = await harness.ok(waiting, { type: 'sync', roomId });
    expect(mine.room.seats[waitingSeat]!.auto).toBe(true);
    // Another player cannot see who is 托管.
    expect((await harness.ok(other, { type: 'sync', roomId })).room.seats[waitingSeat]!.auto).toBe(false);

    const back = await harness.ok(waiting, { type: 'auto', roomId, on: false });
    expect(back.room.seats[waitingSeat]!.auto).toBe(false);
  });

  it('goes back to the lobby after the round and lets a leaver\'s seat go', async () => {
    const harness = new Harness();
    const { roomId, code } = await setUpRoom(harness, ['amy']);
    await harness.ok('host', { type: 'start', roomId });
    expect(await harness.call('bo', { type: 'join', code, nickname: 'bo' })).toEqual({ ok: false, code: 'GAME_IN_PROGRESS' });
    expect(await harness.call('host', { type: 'lobby', roomId })).toEqual({ ok: false, code: 'GAME_IN_PROGRESS' });

    // Amy leaves mid-game: the AI finishes for her and the host plays on alone.
    await harness.ok('amy', { type: 'leave', roomId });
    const host = new Client('host');
    await playOut(harness, roomId, [host]);

    const lobby = await harness.ok('host', { type: 'lobby', roomId });
    expect(lobby.room.status).toBe('lobby');
    expect(lobby.room.seats.map((seat) => seat.kind)).toEqual(['human', 'empty', 'empty', 'empty']);
    expect((await harness.ok('bo', { type: 'join', code, nickname: 'bo' })).room.mySeat).toBe(1);
    const second = await harness.ok('host', { type: 'start', roomId, cursor: null });
    expect(second.game!.gameNo).toBe(2);
  });

  it('passes the host role on when the host leaves and closes an empty room', async () => {
    const harness = new Harness();
    const { roomId, code } = await setUpRoom(harness, ['amy']);
    const after = await harness.ok('host', { type: 'leave', roomId });
    expect(after.room.mySeat).toBeNull();
    expect((await harness.ok('amy', { type: 'sync', roomId })).room.isHost).toBe(true);
    await harness.ok('amy', { type: 'leave', roomId });
    expect(await harness.call('bo', { type: 'join', code, nickname: 'bo' })).toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
  });

  it('retries a write that lost a race', async () => {
    const harness = new Harness();
    const { roomId } = await setUpRoom(harness, []);
    const store = harness.store;
    const original = store.replace.bind(store);
    let raced = false;
    store.replace = async (room, expected) => {
      if (!raced) {
        raced = true;
        // Someone else writes first.
        const current = store.rooms.get(room.id)!;
        store.rooms.set(room.id, { ...current, revision: current.revision + 1 });
      }
      return original(room, expected);
    };
    const response = await harness.ok('host', { type: 'deck', roomId, deckCount: 1 });
    expect(raced).toBe(true);
    expect(response.room.deckCount).toBe(1);
  });

  it('sends only the latest frame to a client far behind', async () => {
    const harness = new Harness();
    const { roomId } = await setUpRoom(harness, []);
    const host = new Client('host');
    host.absorb(await harness.ok('host', { type: 'start', roomId, cursor: null }));
    const total = host.cursor!.frames;
    const fresh = await harness.ok('host', { type: 'sync', roomId, cursor: { gameNo: 99, frames: 0 } });
    expect(fresh.game!.from + fresh.game!.frames.length).toBe(total);
    expect(fresh.game!.frames.length).toBeLessThanOrEqual(12);
  });
});
