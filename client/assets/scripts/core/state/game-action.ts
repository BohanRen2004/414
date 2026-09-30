import { PlayerId } from '../cards/card';

export type GameAction =
  | { readonly kind: 'START_GAME'; readonly seed: number }
  | { readonly kind: 'PLAY_CARDS'; readonly playerId: PlayerId; readonly cardIds: readonly string[] }
  | { readonly kind: 'PASS'; readonly playerId: PlayerId }
  | {
      readonly kind: 'ADD_GOUCHA';
      readonly playerId: PlayerId;
      readonly addition: 'CHA' | 'GOU';
      readonly cardIds: readonly string[];
    }
  | { readonly kind: 'DECLINE_GOUCHA'; readonly playerId: PlayerId };
