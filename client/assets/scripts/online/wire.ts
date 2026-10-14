import { Card, PlayerId, Rank, Suit } from '../core/cards/card';
import { GameState, PlayerState } from '../core/state/game-state';
import { visibleStateFor } from '../ui/visible-state';

/**
 * A seat's view of the game as sent over the network: only the viewer's own hand, other hands as card
 * counts, and no seed or random state until the round is over (the seed alone would reveal every hand).
 */
export interface WirePlayer extends Omit<PlayerState, 'hand'> {
  /** The viewer's own cards; empty for other seats. */
  readonly hand: readonly Card[];
  readonly handCount: number;
}

export interface WireState extends Omit<GameState, 'players'> {
  readonly players: readonly [WirePlayer, WirePlayer, WirePlayer, WirePlayer];
}

/** The state `viewerId` may see, ready to send: gou-cha queries hidden (visible-state.ts) and other hands removed. */
export function toWireState(state: GameState, viewerId: PlayerId): WireState {
  const visible = visibleStateFor(state, viewerId);
  const finished = visible.phase === 'ROUND_RESULT';
  return {
    ...visible,
    rootSeed: finished ? visible.rootSeed : null,
    randomState: null,
    players: visible.players.map((player): WirePlayer => ({
      ...player,
      hand: player.playerId === viewerId ? player.hand : [],
      handCount: player.hand.length,
    })) as unknown as WireState['players'],
  };
}

/** Stand-in for a card the viewer cannot see; only the number of them is ever read. */
function hiddenCard(playerId: PlayerId, index: number): Card {
  return { id: `hidden:${playerId}:${index}`, deckIndex: 0, rank: Rank.THREE, suit: Suit.CLUB };
}

/** A GameState for the client's view model and hints; other hands are placeholders of the right length. */
export function fromWireState(wire: WireState, viewerId: PlayerId): GameState {
  return {
    ...wire,
    players: wire.players.map(({ handCount, ...player }): PlayerState => ({
      ...player,
      hand: player.playerId === viewerId
        ? player.hand
        : Array.from({ length: handCount }, (_, index) => hiddenCard(player.playerId, index)),
    })) as unknown as GameState['players'],
  };
}
