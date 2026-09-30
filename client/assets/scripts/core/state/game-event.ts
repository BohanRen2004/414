import { PlayerId } from '../cards/card';

export type GameEvent =
  | { readonly kind: 'GAME_STARTED' | 'CARDS_DEALT' | 'TRICK_RESET' | 'ROUND_FINISHED' }
  | { readonly kind: 'TURN_CHANGED'; readonly playerId: PlayerId }
  | { readonly kind: 'CARDS_PLAYED'; readonly playerId: PlayerId; readonly cardIds: readonly string[] }
  | { readonly kind: 'PLAYER_PASSED' | 'GOUCHA_DECLINED'; readonly playerId: PlayerId }
  | {
      readonly kind: 'GOUCHA_ADDED';
      readonly playerId: PlayerId;
      readonly addition: 'CHA' | 'GOU';
      readonly cardIds: readonly string[];
    }
  | { readonly kind: 'PLAYER_REPORTED'; readonly playerId: PlayerId; readonly remaining: 1 | 2 | 3 }
  | { readonly kind: 'PLAYER_FINISHED'; readonly playerId: PlayerId; readonly place: 1 | 2 | 3 | 4 };
