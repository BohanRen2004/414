import { PlayerId } from '../../client/assets/scripts/core/cards/card';
import { isDeckCount } from '../../client/assets/scripts/core/cards/deck';
import {
  NICKNAME_MAX_LENGTH, ROOM_CODE_LENGTH, RoomRequest, RoomResponse, SeatMove, SyncCursor,
} from '../../client/assets/scripts/online/protocol';
import {
  EngineResult, RoomRecord, applyMove, backToLobby, gameSync, joinRoom, leaveRoom, moveSeat, newRoom, roomView,
  seatOf, setAuto, setDeckCount, startGame, tick,
} from './engine';

/** Where rooms live: the cloud database in production, a Map in tests. */
export interface RoomStore {
  get(id: string): Promise<RoomRecord | null>;
  /** The open (not closed) room with this code, if any. */
  findOpenByCode(code: string): Promise<RoomRecord | null>;
  insert(room: RoomRecord): Promise<void>;
  /** Write `room` only if the stored revision still equals `expectedRevision`; false when another write won. */
  replace(room: RoomRecord, expectedRevision: number): Promise<boolean>;
  /** Tell these players that the room has something new for them (their inbox doc changes). */
  notify(openids: readonly string[], roomId: string): Promise<void>;
}

export interface RequestContext {
  /** The caller's WeChat openid, from the cloud function context; never taken from the request. */
  readonly openid: string;
  now(): number;
  /** A uniformly random unsigned 32-bit integer. */
  randomUint32(): number;
}

/** Rooms nobody has touched for this long are treated as closed. */
export const ROOM_IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;
const WRITE_ATTEMPTS = 5;
const MAX_CARD_IDS = 64;

// --- Request validation: everything from the client is untrusted ------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanNickname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Drop control characters and surrounding space; keep at most the allowed number of characters.
  const cleaned = [...value.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, NICKNAME_MAX_LENGTH).join('');
  return cleaned === '' ? null : cleaned;
}

function isSeat(value: unknown): value is PlayerId {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function cardIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CARD_IDS) return null;
  return value.every((id) => typeof id === 'string' && id.length <= 16) ? [...value] as string[] : null;
}

function parseMove(value: unknown): SeatMove | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'PASS': return { kind: 'PASS' };
    case 'DECLINE_GOUCHA': return { kind: 'DECLINE_GOUCHA' };
    case 'PLAY_CARDS': {
      const ids = cardIds(value.cardIds);
      return ids === null ? null : { kind: 'PLAY_CARDS', cardIds: ids };
    }
    case 'ADD_GOUCHA': {
      const ids = cardIds(value.cardIds);
      if (ids === null || (value.addition !== 'CHA' && value.addition !== 'GOU')) return null;
      return { kind: 'ADD_GOUCHA', addition: value.addition, cardIds: ids };
    }
    default: return null;
  }
}

function parseCursor(value: unknown): SyncCursor | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRecord(value) || !Number.isSafeInteger(value.gameNo) || !Number.isSafeInteger(value.frames)) return undefined;
  return { gameNo: value.gameNo as number, frames: value.frames as number };
}

/** Validate a raw request; null when it is malformed. */
export function parseRequest(raw: unknown): RoomRequest | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  if (raw.type === 'create') {
    const nickname = cleanNickname(raw.nickname);
    return nickname !== null && isDeckCount(raw.deckCount) ? { type: 'create', nickname, deckCount: raw.deckCount } : null;
  }
  if (raw.type === 'join') {
    const nickname = cleanNickname(raw.nickname);
    const code = typeof raw.code === 'string' ? raw.code.trim() : '';
    return nickname !== null && new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(code) ? { type: 'join', code, nickname } : null;
  }
  if (typeof raw.roomId !== 'string' || raw.roomId.length === 0 || raw.roomId.length > 64) return null;
  const cursor = parseCursor(raw.cursor);
  const base = { roomId: raw.roomId, ...(cursor === undefined ? {} : { cursor }) };
  switch (raw.type) {
    case 'sync': case 'start': case 'tick': case 'lobby': case 'leave':
      return { ...base, type: raw.type };
    case 'seat': return isSeat(raw.seat) ? { ...base, type: 'seat', seat: raw.seat } : null;
    case 'deck': return isDeckCount(raw.deckCount) ? { ...base, type: 'deck', deckCount: raw.deckCount } : null;
    case 'auto': return typeof raw.on === 'boolean' ? { ...base, type: 'auto', on: raw.on } : null;
    case 'move': {
      const move = parseMove(raw.move);
      return move === null ? null : { ...base, type: 'move', move };
    }
    default: return null;
  }
}

// --- Handling -----------------------------------------------------------------------------------------

function isOpen(room: RoomRecord | null, now: number): room is RoomRecord {
  return room !== null && room.status !== 'closed' && now - room.updatedAt < ROOM_IDLE_LIMIT_MS;
}

function reply(room: RoomRecord, context: RequestContext, cursor: SyncCursor | null | undefined): RoomResponse {
  return {
    ok: true,
    room: roomView(room, context.openid),
    game: cursor === undefined ? null : gameSync(room, context.openid, cursor),
    serverTime: context.now(),
  };
}

function randomCode(context: RequestContext): string {
  return String(context.randomUint32() % 10 ** ROOM_CODE_LENGTH).padStart(ROOM_CODE_LENGTH, '0');
}

function randomId(context: RequestContext): string {
  return Array.from({ length: 4 }, () => context.randomUint32().toString(16).padStart(8, '0')).join('');
}

async function createRoom(store: RoomStore, context: RequestContext, request: Extract<RoomRequest, { type: 'create' }>): Promise<RoomResponse> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomCode(context);
    if (isOpen(await store.findOpenByCode(code), context.now())) continue;
    const room = newRoom(randomId(context), code, context.openid, request.nickname, request.deckCount, context.now());
    await store.insert(room);
    return reply(room, context, undefined);
  }
  return { ok: false, code: 'BUSY' };
}

/** Read, change and write a room, retrying when another request wrote it first. */
async function update(
  store: RoomStore,
  context: RequestContext,
  load: () => Promise<RoomRecord | null>,
  change: (room: RoomRecord) => EngineResult,
  cursor: SyncCursor | null | undefined,
): Promise<RoomResponse> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const room = await load();
    if (!isOpen(room, context.now())) return { ok: false, code: 'ROOM_NOT_FOUND' };
    const result = change(room);
    if (!result.ok) return result.ruleCode === undefined ? { ok: false, code: result.code } : { ok: false, code: result.code, ruleCode: result.ruleCode };
    if (result.room === room) return reply(room, context, cursor);
    const next = { ...result.room, revision: room.revision + 1 };
    if (!await store.replace(next, room.revision)) continue;
    const others = result.notify.filter((openid) => openid !== context.openid);
    if (others.length > 0) await store.notify(others, next.id);
    return reply(next, context, cursor);
  }
  return { ok: false, code: 'BUSY' };
}

export async function handleRoomRequest(store: RoomStore, context: RequestContext, raw: unknown): Promise<RoomResponse> {
  const request = parseRequest(raw);
  if (request === null) return { ok: false, code: 'BAD_REQUEST' };
  const now = context.now();
  if (request.type === 'create') return createRoom(store, context, request);
  if (request.type === 'join') {
    const found = await store.findOpenByCode(request.code);
    if (!isOpen(found, now)) return { ok: false, code: 'ROOM_NOT_FOUND' };
    return update(store, context, () => store.get(found.id), (room) => joinRoom(room, context.openid, request.nickname, now), null);
  }

  const load = () => store.get(request.roomId);
  const cursor = request.cursor;
  if (request.type === 'sync') {
    const room = await load();
    if (!isOpen(room, now)) return { ok: false, code: 'ROOM_NOT_FOUND' };
    if (seatOf(room, context.openid) === null) return { ok: false, code: 'NOT_IN_ROOM' };
    return reply(room, context, cursor ?? null);
  }
  const openid = context.openid;
  switch (request.type) {
    case 'seat': return update(store, context, load, (room) => moveSeat(room, openid, request.seat, now), cursor);
    case 'deck': return update(store, context, load, (room) => setDeckCount(room, openid, request.deckCount, now), cursor);
    case 'start': return update(store, context, load, (room) => startGame(room, openid, context.randomUint32(), now), cursor ?? null);
    case 'move': return update(store, context, load, (room) => applyMove(room, openid, request.move, now), cursor ?? null);
    case 'auto': return update(store, context, load, (room) => setAuto(room, openid, request.on, now), cursor ?? null);
    case 'tick': return update(store, context, load, (room) => (seatOf(room, openid) === null ? { ok: false, code: 'NOT_IN_ROOM' } : tick(room, now)), cursor);
    case 'lobby': return update(store, context, load, (room) => backToLobby(room, openid, now), cursor);
    case 'leave': return update(store, context, load, (room) => leaveRoom(room, openid, now), undefined);
  }
}
