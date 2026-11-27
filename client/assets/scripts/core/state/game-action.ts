import { PlayerId } from '../cards/card';
import type { DeckCount, PlayerCount } from '../cards/deck';

export type GameAction =
  /** `deckCount` picks the game version; omitted means two decks. */
  /** `playerCount` seats 2, 3 or 4 players (default 4); fewer than four play with one deck. */
  | { readonly kind: 'START_GAME'; readonly seed: number; readonly deckCount?: DeckCount; readonly playerCount?: PlayerCount }
  | { readonly kind: 'PLAY_CARDS'; readonly playerId: PlayerId; readonly cardIds: readonly string[] }
  | { readonly kind: 'PASS'; readonly playerId: PlayerId }
  | {
      readonly kind: 'ADD_GOUCHA';
      readonly playerId: PlayerId;
      readonly addition: 'CHA' | 'GOU';
      readonly cardIds: readonly string[];
    }
  | { readonly kind: 'DECLINE_GOUCHA'; readonly playerId: PlayerId };
