import { Card, PlayerId, Rank, TeamId } from '../cards/card';
import type { DeckCount, PlayerCount } from '../cards/deck';
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
  /** Action number of the lead that opened this trick; every public record from it on belongs to the trick. */
  readonly leadActionNumber: number;
}

/** Only actions every seat sees; a private gou-cha decline is never recorded. */
export interface PublicActionRecord {
  readonly actionNumber: number;
  readonly playerId: PlayerId;
  readonly kind: 'PLAY_CARDS' | 'PASS' | 'CHA' | 'GOU';
  readonly cardIds: readonly string[];
}

export interface GameResult {
  /** Every seated player in finishing order. */
  readonly finishOrder: readonly PlayerId[];
  /** The first finisher's team (with fewer than four players, the first finisher alone). */
  readonly winningTeam: TeamId;
  /** Four players only: opponents finishing after the winners' second player. Always 0 otherwise. */
  readonly capturedOpponents: 0 | 1 | 2;
}

export interface GameState {
  readonly rulesVersion: typeof RULES_VERSION;
  readonly phase: GamePhase;
  readonly rootSeed: number | null;
  /** Game version set by START_GAME: one deck (54 cards) or two decks (108 cards); null before the deal. */
  readonly deckCount: DeckCount | null;
  /** Players at the table; seats from this number on are empty (no cards, never act). */
  readonly playerCount: PlayerCount;
  /** Cards dealt to nobody (two players set 10 aside). Hidden from every player. */
  readonly buriedCardIds: readonly string[];
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
