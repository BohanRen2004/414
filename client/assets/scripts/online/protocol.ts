import { PlayerId } from '../core/cards/card';
import { DeckCount } from '../core/cards/deck';
import { GameAction } from '../core/state/game-action';
import { GameEvent } from '../core/state/game-event';
import { WireState } from './wire';

/**
 * Messages between the mini game and the `room` cloud function. The server holds the deal and the action
 * log; a client only ever receives its own seat's frames, with other hands reduced to card counts.
 */

/** How long a human may think before the server lets the AI play that seat (托管). */
export const TURN_TIME_MS = 60_000;
export const NICKNAME_MAX_LENGTH = 12;
export const ROOM_CODE_LENGTH = 6;

/** A move the player makes at their own seat; the server fills in the seat. */
export type SeatMove =
  | { readonly kind: 'PLAY_CARDS'; readonly cardIds: readonly string[] }
  | { readonly kind: 'PASS' }
  | { readonly kind: 'ADD_GOUCHA'; readonly addition: 'CHA' | 'GOU'; readonly cardIds: readonly string[] }
  | { readonly kind: 'DECLINE_GOUCHA' };

/** Where the client's copy of the game stands: which game and how many of its frames it already has. */
export interface SyncCursor {
  readonly gameNo: number;
  readonly frames: number;
}

/** Requests about an existing room; `cursor` asks for the caller's new frames in the reply. */
type InRoom<T> = T & { readonly roomId: string; readonly cursor?: SyncCursor | null };

export type RoomRequest =
  | { readonly type: 'create'; readonly nickname: string; readonly deckCount: DeckCount }
  | { readonly type: 'join'; readonly code: string; readonly nickname: string }
  | InRoom<{ readonly type: 'sync' }>
  | InRoom<{ readonly type: 'seat'; readonly seat: PlayerId }>
  | InRoom<{ readonly type: 'deck'; readonly deckCount: DeckCount }>
  | InRoom<{ readonly type: 'start' }>
  | InRoom<{ readonly type: 'move'; readonly move: SeatMove }>
  | InRoom<{ readonly type: 'auto'; readonly on: boolean }>
  | InRoom<{ readonly type: 'tick' }>
  | InRoom<{ readonly type: 'lobby' }>
  | InRoom<{ readonly type: 'leave' }>;

export type RoomErrorCode =
  | 'BAD_REQUEST'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'SEAT_TAKEN'
  | 'WRONG_STATUS'
  | 'BUSY'
  | 'RULE_REJECTED';

export interface SeatView {
  readonly kind: 'empty' | 'ai' | 'human';
  /** Nickname for a human, "AI" for an AI seat, empty for an empty seat. */
  readonly name: string;
  readonly isMe: boolean;
  readonly isHost: boolean;
  /** Whether the AI plays this seat for its owner; only reported for the viewer's own seat. */
  readonly auto: boolean;
}

export interface RoomView {
  readonly roomId: string;
  readonly code: string;
  readonly status: 'lobby' | 'playing' | 'closed';
  readonly deckCount: DeckCount;
  readonly isHost: boolean;
  readonly mySeat: PlayerId | null;
  readonly seats: readonly [SeatView, SeatView, SeatView, SeatView];
  /** Number of the current or last game in this room; 0 before the first start. */
  readonly gameNo: number;
}

export interface WireFrame {
  readonly events: readonly GameEvent[];
  readonly state: WireState;
}

export interface GameSync {
  readonly gameNo: number;
  /**
   * Index of the first frame sent. It is the client's cursor when the client is close behind; when it is
   * far behind or on another game, only the latest frame is sent and `from` jumps ahead.
   */
  readonly from: number;
  readonly frames: readonly WireFrame[];
  /** When the server lets the AI take over the viewer's pending turn, in server time; null if it is not their turn. */
  readonly myDeadline: number | null;
}

export type RoomResponse =
  | {
      readonly ok: true;
      readonly room: RoomView;
      readonly game: GameSync | null;
      readonly serverTime: number;
    }
  | {
      readonly ok: false;
      readonly code: RoomErrorCode;
      /** The rules core's reason when a move is rejected. */
      readonly ruleCode?: string;
    };

/** The full action for a seat move. */
export function moveAction(move: SeatMove, playerId: PlayerId): GameAction {
  switch (move.kind) {
    case 'PLAY_CARDS': return { kind: 'PLAY_CARDS', playerId, cardIds: [...move.cardIds] };
    case 'PASS': return { kind: 'PASS', playerId };
    case 'ADD_GOUCHA': return { kind: 'ADD_GOUCHA', playerId, addition: move.addition, cardIds: [...move.cardIds] };
    case 'DECLINE_GOUCHA': return { kind: 'DECLINE_GOUCHA', playerId };
  }
}

/** The seat move behind an action the client built locally. */
export function seatMove(action: GameAction): SeatMove {
  switch (action.kind) {
    case 'PLAY_CARDS': return { kind: 'PLAY_CARDS', cardIds: [...action.cardIds] };
    case 'PASS': return { kind: 'PASS' };
    case 'ADD_GOUCHA': return { kind: 'ADD_GOUCHA', addition: action.addition, cardIds: [...action.cardIds] };
    case 'DECLINE_GOUCHA': return { kind: 'DECLINE_GOUCHA' };
    case 'START_GAME': throw new Error('START_GAME is not a seat move');
  }
}
