import { PlayerId, Rank } from '../cards/card';

export type PatternErrorCode =
  | 'EMPTY'
  | 'DUPLICATE_CARD_ID'
  | 'MIXED_RANKS'
  | 'SEQUENCE_TOO_SHORT'
  | 'SEQUENCE_GAP'
  | 'SEQUENCE_FORBIDDEN_RANK'
  | 'SEQUENCE_MULTIPLICITY'
  | 'UNSUPPORTED_COMBINATION';

export type PlayPattern =
  | { readonly kind: 'SINGLE'; readonly rank: Rank }
  | { readonly kind: 'PAIR'; readonly rank: Rank }
  | {
      readonly kind: 'STRAIGHT' | 'DOUBLE_STRAIGHT' | 'TRIPLE_STRAIGHT';
      readonly multiplicity: 1 | 2 | 3;
      readonly runLength: number;
      readonly low: Rank;
      readonly high: Rank;
    }
  | { readonly kind: 'N_OF_KIND_BOMB'; readonly rank: Rank; readonly count: number }
  | { readonly kind: 'JOKER_BOMB' }
  | { readonly kind: 'FOUR_A_FOUR'; readonly allHearts: boolean }
  | { readonly kind: 'INVALID'; readonly reason: PatternErrorCode };

export interface CardGroup {
  readonly cardIds: readonly string[];
  readonly pattern: Exclude<PlayPattern, { kind: 'INVALID' }>;
  readonly playerId: PlayerId;
  readonly actionNumber: number;
}
