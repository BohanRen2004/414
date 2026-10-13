import { Card, PlayerId, Rank, TeamId } from '../cards/card';
import { CardGroup } from '../patterns/play-pattern';
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

/**
 * CHA and GOU are actions on a single, not a pattern: the additions are never merged into a bomb and
 * nothing is compared against them. While the chain runs, the trick's current play stays `basePlay`.
 */
export interface GouChaChain {
  readonly rank: Rank;
  /** The single that started the chain; it is also the trick's current play. */
  readonly basePlay: CardGroup;
  readonly additions: readonly GouChaAddition[];
  /** The latest contributor: the base player until a CHA, then whoever added last. */
  readonly holderId: PlayerId;
  readonly nextAddition: 'CHA' | 'GOU';
  readonly queryCursor: PlayerId;
  readonly declinedPlayerIds: readonly PlayerId[];
}

export interface TrickState {
  /** The play responders must beat; during a gou-cha chain it is the chain's base single. */
  readonly currentPlay: CardGroup;
  /** Latest successful play or, during a gou-cha chain, the latest CHA/GOU contributor. */
  readonly holderId: PlayerId;
  readonly nextResponder: PlayerId | null;
  readonly passedPlayerIds: readonly PlayerId[];
  readonly gouCha: GouChaChain | null;
}

/** Only actions every seat sees; a private gou-cha decline is never recorded. */
export interface PublicActionRecord {
  readonly actionNumber: number;
  readonly playerId: PlayerId;
  readonly kind: 'PLAY_CARDS' | 'PASS' | 'CHA' | 'GOU';
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
  readonly randomState: { readonly deal: number } | null;
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
