import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { PlayerId } from '../../client/assets/scripts/core/cards/card';
import { DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { applyAction, createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GamePhase, GameState } from '../../client/assets/scripts/core/state/game-state';
import {
  GameSync, RoomErrorCode, RoomView, SeatMove, SeatView, SyncCursor, TURN_TIME_MS, WireFrame, moveAction,
} from '../../client/assets/scripts/online/protocol';
import { toWireState } from '../../client/assets/scripts/online/wire';
import { SeatFrame, SeatPresenter } from '../../client/assets/scripts/ui/seat-presenter';
import { visibleEventsFor, visibleStateFor } from '../../client/assets/scripts/ui/visible-state';

/**
 * Room rules on the server, as pure functions over a stored record: seats, the host, AI fill, and the game
 * itself. The game is stored as its seed plus the action log and rebuilt by replaying it through the rules
 * core, which also yields every seat's frames (seat-presenter.ts) without storing any of them.
 */

export interface HumanSeat {
  readonly kind: 'human';
  readonly openid: string;
  readonly nickname: string;
  /** The AI plays this seat for its owner (托管): after a timeout, on request, or after leaving. */
  readonly auto: boolean;
  /** The owner left during a game; the seat is freed when the room goes back to the lobby. */
  readonly left: boolean;
}

export type Occupant = HumanSeat | { readonly kind: 'ai' } | null;
export type Seats = readonly [Occupant, Occupant, Occupant, Occupant];

export interface RoomGame {
  readonly gameNo: number;
  readonly seed: number;
  readonly deckCount: DeckCount;
  /** Every accepted action after the deal, AI moves included, in order. */
  readonly actions: readonly GameAction[];
  /** The human decision the game waits on, keyed by the action count at which it opened. */
  readonly turn: { readonly key: number; readonly seat: PlayerId; readonly deadline: number } | null;
  /** Frames each seat has been shown so far; a seat is notified only when its count grows. */
  readonly frameCounts: readonly [number, number, number, number];
}

export interface RoomRecord {
  readonly id: string;
  readonly code: string;
  readonly status: 'lobby' | 'playing' | 'closed';
  readonly hostOpenid: string;
  readonly deckCount: DeckCount;
  readonly seats: Seats;
  readonly gameCount: number;
  readonly game: RoomGame | null;
  /** Bumped on every write; the store only accepts a write based on the latest revision. */
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type EngineResult =
  | { readonly ok: true; readonly room: RoomRecord; readonly notify: readonly string[] }
  | { readonly ok: false; readonly code: RoomErrorCode; readonly ruleCode?: string };

const SEAT_IDS = [0, 1, 2, 3] as const satisfies readonly PlayerId[];
const MAX_PUMPED_ACTIONS = 5_000;
/** A client further behind than this gets only the latest frame instead of an animation of every move. */
export const MAX_FRAMES_PER_SYNC = 12;

function fail(code: RoomErrorCode, ruleCode?: string): EngineResult {
  return ruleCode === undefined ? { ok: false, code } : { ok: false, code, ruleCode };
}

function isHuman(occupant: Occupant): occupant is HumanSeat {
  return occupant !== null && occupant.kind === 'human';
}

export function seatOf(room: RoomRecord, openid: string): PlayerId | null {
  const index = room.seats.findIndex((occupant) => isHuman(occupant) && occupant.openid === openid);
  return index < 0 ? null : (index as PlayerId);
}

function humans(seats: Seats): HumanSeat[] {
  return seats.filter(isHuman);
}

function present(seats: Seats): string[] {
  return humans(seats).filter((seat) => !seat.left).map((seat) => seat.openid);
}

function withSeat(seats: Seats, seat: PlayerId, occupant: Occupant): Seats {
  return seats.map((current, index) => (index === seat ? occupant : current)) as unknown as Seats;
}

function isActivePhase(phase: GamePhase): boolean {
  return phase === 'FREE_LEAD' || phase === 'RESPONDING' || phase === 'GOUCHA_QUERY';
}

export function newRoom(id: string, code: string, openid: string, nickname: string, deckCount: DeckCount, now: number): RoomRecord {
  return {
    id,
    code,
    status: 'lobby',
    hostOpenid: openid,
    deckCount,
    seats: [{ kind: 'human', openid, nickname, auto: false, left: false }, null, null, null],
    gameCount: 0,
    game: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// --- Replaying the game ----------------------------------------------------------------------------------

export interface Replay {
  readonly state: GameState;
  /** Frames for each requested viewer, in order. */
  readonly frames: ReadonlyMap<PlayerId, readonly SeatFrame[]>;
}

/** Rebuild the game from its seed and action log, collecting the frames each viewer would have been shown. */
export function replayGame(game: Pick<RoomGame, 'seed' | 'deckCount' | 'actions'>, viewers: readonly PlayerId[] = []): Replay {
  const setup = createSetupState();
  const presenters = viewers.map((viewer) => new SeatPresenter(viewer, setup));
  const frames = new Map<PlayerId, SeatFrame[]>(viewers.map((viewer) => [viewer, []]));
  const step = (state: GameState, action: GameAction): GameState => {
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(`stored action log does not replay: ${result.error.code}`);
    for (const presenter of presenters) {
      const own = action.kind !== 'START_GAME' && action.playerId === presenter.viewerId;
      frames.get(presenter.viewerId)!.push(...presenter.transition(result.events, result.state, own));
    }
    return result.state;
  };
  let state = step(setup, { kind: 'START_GAME', seed: game.seed, deckCount: game.deckCount });
  for (const action of game.actions) state = step(state, action);
  return { state, frames };
}

/** Let the AI play every seat it controls (AI seats, 托管 seats) until a human must decide or the round ends. */
function pump(state: GameState, seats: Seats, actions: GameAction[]): GameState {
  let current = state;
  for (let count = 0; count < MAX_PUMPED_ACTIONS; count += 1) {
    const playerId = current.currentPlayer;
    if (!isActivePhase(current.phase) || playerId === null) return current;
    const occupant = seats[playerId];
    if (isHuman(occupant) && !occupant.auto) return current;
    const action = chooseBasicAiAction(buildObservation(current, playerId));
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`AI action rejected: ${result.error.code}`);
    actions.push(action);
    current = result.state;
  }
  throw new Error('AI did not reach a human decision');
}

/**
 * Store a game after a change: AI turns played, the waiting human's deadline set (kept while the same
 * decision is still open), and every seat's frame count updated. Humans with new frames are notified.
 */
function settle(room: RoomRecord, game: RoomGame, seats: Seats, now: number, notifyAll: boolean): EngineResult {
  const actions = [...game.actions];
  const before = replayGame(game).state;
  const state = pump(before, seats, actions);
  const replay = replayGame({ ...game, actions }, SEAT_IDS);
  const waitingOn = isActivePhase(state.phase) ? state.currentPlayer : null;
  const key = actions.length;
  const turn = waitingOn === null ? null
    : game.turn !== null && game.turn.key === key && game.turn.seat === waitingOn ? game.turn
      : { key, seat: waitingOn, deadline: now + TURN_TIME_MS };
  const frameCounts = SEAT_IDS.map((seat) => replay.frames.get(seat)!.length) as unknown as RoomGame['frameCounts'];
  const notify = seats.flatMap((occupant, seat) => {
    if (!isHuman(occupant) || occupant.left) return [];
    return notifyAll || frameCounts[seat] !== game.frameCounts[seat] ? [occupant.openid] : [];
  });
  return {
    ok: true,
    room: { ...room, seats, game: { ...game, actions, turn, frameCounts }, updatedAt: now },
    notify,
  };
}

function currentState(room: RoomRecord): GameState | null {
  return room.game === null ? null : replayGame(room.game).state;
}

// --- Lobby ---------------------------------------------------------------------------------------------

export function joinRoom(room: RoomRecord, openid: string, nickname: string, now: number): EngineResult {
  if (room.status === 'closed') return fail('ROOM_NOT_FOUND');
  const seat = seatOf(room, openid);
  if (seat !== null) {
    // Coming back: the seat is theirs again, with the AI still playing it until they take it back.
    const occupant = room.seats[seat] as HumanSeat;
    if (!occupant.left && occupant.nickname === nickname) return { ok: true, room, notify: [] };
    const seats = withSeat(room.seats, seat, { ...occupant, nickname, left: false });
    return { ok: true, room: { ...room, seats, updatedAt: now }, notify: present(seats) };
  }
  if (room.status !== 'lobby') return fail('GAME_IN_PROGRESS');
  const empty = room.seats.findIndex((occupant) => occupant === null);
  if (empty < 0) return fail('ROOM_FULL');
  const seats = withSeat(room.seats, empty as PlayerId, { kind: 'human', openid, nickname, auto: false, left: false });
  return { ok: true, room: { ...room, seats, updatedAt: now }, notify: present(seats) };
}

export function moveSeat(room: RoomRecord, openid: string, target: PlayerId, now: number): EngineResult {
  if (room.status !== 'lobby') return fail('WRONG_STATUS');
  const seat = seatOf(room, openid);
  if (seat === null) return fail('NOT_IN_ROOM');
  if (seat === target) return { ok: true, room, notify: [] };
  if (room.seats[target] !== null) return fail('SEAT_TAKEN');
  const seats = withSeat(withSeat(room.seats, target, room.seats[seat]), seat, null);
  return { ok: true, room: { ...room, seats, updatedAt: now }, notify: present(seats) };
}

export function setDeckCount(room: RoomRecord, openid: string, deckCount: DeckCount, now: number): EngineResult {
  if (room.status !== 'lobby') return fail('WRONG_STATUS');
  if (room.hostOpenid !== openid) return fail('NOT_HOST');
  if (room.deckCount === deckCount) return { ok: true, room, notify: [] };
  return { ok: true, room: { ...room, deckCount, updatedAt: now }, notify: present(room.seats) };
}

/** Host only: empty seats get the AI and the deal comes from the server's random seed. */
export function startGame(room: RoomRecord, openid: string, seed: number, now: number): EngineResult {
  if (room.status !== 'lobby') return fail('WRONG_STATUS');
  if (room.hostOpenid !== openid) return fail('NOT_HOST');
  const seats = room.seats.map((occupant) => occupant ?? { kind: 'ai' }) as unknown as Seats;
  const game: RoomGame = {
    gameNo: room.gameCount + 1,
    seed: seed >>> 0,
    deckCount: room.deckCount,
    actions: [],
    turn: null,
    frameCounts: [0, 0, 0, 0],
  };
  return settle({ ...room, status: 'playing', gameCount: game.gameNo }, game, seats, now, true);
}

/** Host only, after the round: back to the room, AI and departed players' seats freed for new friends. */
export function backToLobby(room: RoomRecord, openid: string, now: number): EngineResult {
  if (room.status !== 'playing') return fail('WRONG_STATUS');
  if (room.hostOpenid !== openid) return fail('NOT_HOST');
  if (currentState(room)?.phase !== 'ROUND_RESULT') return fail('GAME_IN_PROGRESS');
  const seats = room.seats.map((occupant) => (isHuman(occupant) && !occupant.left ? { ...occupant, auto: false } : null)) as unknown as Seats;
  return { ok: true, room: { ...room, status: 'lobby', seats, game: null, updatedAt: now }, notify: present(room.seats) };
}

/** The host role passes to the first human still at the table; with nobody left the room closes. */
function withHost(room: RoomRecord, seats: Seats): RoomRecord {
  const remaining = humans(seats).filter((seat) => !seat.left);
  if (remaining.length === 0) return { ...room, seats, status: 'closed' };
  const hostStays = remaining.some((seat) => seat.openid === room.hostOpenid);
  return { ...room, seats, hostOpenid: hostStays ? room.hostOpenid : remaining[0]!.openid };
}

export function leaveRoom(room: RoomRecord, openid: string, now: number): EngineResult {
  const seat = seatOf(room, openid);
  if (seat === null) return { ok: true, room, notify: [] };
  const occupant = room.seats[seat] as HumanSeat;
  if (room.status !== 'playing' || room.game === null) {
    const next = withHost(room, withSeat(room.seats, seat, null));
    return { ok: true, room: { ...next, updatedAt: now }, notify: present(next.seats) };
  }
  const seats = withSeat(room.seats, seat, { ...occupant, auto: true, left: true });
  const next = withHost(room, seats);
  if (next.status === 'closed') return { ok: true, room: { ...next, updatedAt: now }, notify: [] };
  return settle(next, room.game, seats, now, true);
}

// --- Playing -------------------------------------------------------------------------------------------

export function applyMove(room: RoomRecord, openid: string, move: SeatMove, now: number): EngineResult {
  if (room.status !== 'playing' || room.game === null) return fail('WRONG_STATUS');
  const seat = seatOf(room, openid);
  if (seat === null) return fail('NOT_IN_ROOM');
  if ((room.seats[seat] as HumanSeat).auto) return fail('RULE_REJECTED', 'NOT_CURRENT_PLAYER');
  const state = replayGame(room.game).state;
  const action = moveAction(move, seat);
  const result = applyAction(state, action);
  if (!result.ok) return fail('RULE_REJECTED', result.error.code);
  return settle(room, { ...room.game, actions: [...room.game.actions, action] }, room.seats, now, false);
}

/** Turn 托管 on or off for the caller's own seat. */
export function setAuto(room: RoomRecord, openid: string, on: boolean, now: number): EngineResult {
  if (room.status !== 'playing' || room.game === null) return fail('WRONG_STATUS');
  const seat = seatOf(room, openid);
  if (seat === null) return fail('NOT_IN_ROOM');
  const occupant = room.seats[seat] as HumanSeat;
  if (occupant.auto === on) return { ok: true, room, notify: [] };
  const seats = withSeat(room.seats, seat, { ...occupant, auto: on });
  // Taking a seat back opens a fresh decision window, so the deadline restarts.
  const game = on ? room.game : { ...room.game, turn: null };
  return settle(room, game, seats, now, false);
}

/** Anyone may ask; once the waiting human's time is up, the AI takes over their seat. */
export function tick(room: RoomRecord, now: number): EngineResult {
  const turn = room.game?.turn ?? null;
  if (room.status !== 'playing' || room.game === null || turn === null || now < turn.deadline) {
    return { ok: true, room, notify: [] };
  }
  const occupant = room.seats[turn.seat];
  if (!isHuman(occupant)) return { ok: true, room, notify: [] };
  const result = settle(room, room.game, withSeat(room.seats, turn.seat, { ...occupant, auto: true }), now, false);
  // The owner also learns that their seat is now played for them.
  return result.ok && !result.notify.includes(occupant.openid) ? { ...result, notify: [...result.notify, occupant.openid] } : result;
}

// --- Views ---------------------------------------------------------------------------------------------

export function roomView(room: RoomRecord, openid: string): RoomView {
  const mySeat = seatOf(room, openid);
  const seats = room.seats.map((occupant, index): SeatView => {
    if (occupant === null) return { kind: 'empty', name: '', isMe: false, isHost: false, auto: false };
    if (occupant.kind === 'ai') return { kind: 'ai', name: 'AI', isMe: false, isHost: false, auto: false };
    const isMe = index === mySeat;
    return { kind: 'human', name: occupant.nickname, isMe, isHost: occupant.openid === room.hostOpenid, auto: isMe && occupant.auto };
  }) as unknown as RoomView['seats'];
  return {
    roomId: room.id,
    code: room.code,
    status: room.status,
    deckCount: room.deckCount,
    isHost: room.hostOpenid === openid,
    mySeat,
    seats,
    gameNo: room.game?.gameNo ?? room.gameCount,
  };
}

function wireFrame(frame: SeatFrame, viewer: PlayerId): WireFrame {
  return {
    events: visibleEventsFor(frame.events, visibleStateFor(frame.state, viewer), viewer),
    state: toWireState(frame.state, viewer),
  };
}

/** The viewer's frames after their cursor: all of them when close behind, else just the latest. */
export function gameSync(room: RoomRecord, openid: string, cursor: SyncCursor | null): GameSync | null {
  const seat = seatOf(room, openid);
  if (room.game === null || seat === null) return null;
  const frames = replayGame(room.game, [seat]).frames.get(seat)!;
  const known = cursor !== null && cursor.gameNo === room.game.gameNo ? Math.min(Math.max(0, cursor.frames), frames.length) : 0;
  const from = frames.length - known > MAX_FRAMES_PER_SYNC ? frames.length - 1 : known;
  const turn = room.game.turn;
  return {
    gameNo: room.game.gameNo,
    from,
    frames: frames.slice(from).map((frame) => wireFrame(frame, seat)),
    myDeadline: turn !== null && turn.seat === seat && !(room.seats[seat] as HumanSeat).auto ? turn.deadline : null,
  };
}
