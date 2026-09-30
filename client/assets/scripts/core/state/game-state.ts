import { Card, PlayerId, Rank, TeamId } from '../cards/card';
import { CardGroup, PlayPattern } from '../patterns/play-pattern';
import { RULES_VERSION } from '../index';

export type GamePhase =
  | 'SETUP'
  | 'DEALING'
  | 'FREE_LEAD'
  | 'GOUCHA_QUERY'
  | 'RESPONDING'
  | 'TRICK_RESET'
  | 'ROUND_RESULT'
  | 'FATAL_ERROR';

export interface PlayerState {
  readonly playerId: PlayerId;
  readonly teamId: TeamId;
  readonly controlType: 'HUMAN' | 'BASIC_AI';
  readonly hand: readonly Card[];
  readonly finishPlace: 1 | 2 | 3 | 4 | null;
  readonly lastReportedCount: 1 | 2 | 3 | null;
}

export interface GouChaAddition {
  readonly addition: 'CHA' | 'GOU';
  readonly playerId: PlayerId;
  readonly cardIds: readonly string[];
  readonly actionNumber: number;
}

export interface GouChaChain {
  readonly rank: Rank;
  readonly basePlay: CardGroup;
  readonly additions: readonly GouChaAddition[];
  readonly aggregateCardIds: readonly string[];
  readonly aggregatePattern: Extract<PlayPattern, { kind: 'SINGLE' | 'N_OF_KIND_BOMB' }>;
  readonly holderId: PlayerId;
  readonly nextAddition: 'CHA' | 'GOU';
  readonly queryCursor: PlayerId;
  readonly declinedPlayerIds: readonly PlayerId[];
}

export interface TrickState {
  readonly currentPlay: CardGroup;
  readonly holderId: PlayerId;
  readonly nextResponder: PlayerId | null;
  readonly passedPlayerIds: readonly PlayerId[];
  readonly gouCha: GouChaChain | null;
}

export interface PublicActionRecord {
  readonly actionNumber: number;
  readonly playerId: PlayerId;
  readonly kind: 'PLAY_CARDS' | 'PASS' | 'CHA' | 'GOU' | 'DECLINE_GOUCHA';
  readonly cardIds: readonly string[];
}

export interface GameResult {
  readonly finishOrder: readonly [PlayerId, PlayerId, PlayerId, PlayerId];
  readonly winningTeam: TeamId;
  readonly capturedOpponents: 0 | 1 | 2;
}

export interface GameState {
  readonly rulesVersion: typeof RULES_VERSION;
  readonly phase: GamePhase;
  readonly rootSeed: number | null;
  readonly randomState: { readonly deal: number; readonly ai: number } | null;
  readonly firstPlayer: PlayerId | null;
  readonly players: readonly [PlayerState, PlayerState, PlayerState, PlayerState];
  readonly currentPlayer: PlayerId | null;
  readonly trick: TrickState | null;
  readonly finishOrder: readonly PlayerId[];
  readonly playedCardIds: readonly string[];
  readonly publicHistory: readonly PublicActionRecord[];
  readonly actionNumber: number;
  readonly result: GameResult | null;
}
