import { PlayerId } from '../core/cards/card';
import { nextActivePlayer } from '../core/rules/normal-trick';
import { GameEvent } from '../core/state/game-event';
import { GameState } from '../core/state/game-state';

/**
 * True while the rules core asks another seat about gou-cha. Who is asked depends on hidden
 * hands, so the viewer must not be able to tell that a query is happening at all.
 */
export function hidesGouChaQuery(state: GameState, viewerId: PlayerId): boolean {
  return state.phase === 'GOUCHA_QUERY' && state.currentPlayer !== viewerId;
}

/**
 * The state as one seat may see it. Another seat's pending gou-cha query looks like the ordinary
 * response the chain closes into when nobody joins: the aggregate stays on the table and the seat
 * after the holder is to respond. The viewer's own query and every other state are returned as is.
 */
export function visibleStateFor(state: GameState, viewerId: PlayerId): GameState {
  const chain = state.trick?.gouCha;
  if (!hidesGouChaQuery(state, viewerId) || state.trick === null || chain === null || chain === undefined) return state;
  const nextResponder = nextActivePlayer(state.players, chain.holderId);
  return {
    ...state,
    phase: 'RESPONDING',
    currentPlayer: nextResponder,
    trick: {
      ...state.trick,
      holderId: chain.holderId,
      nextResponder,
      passedPlayerIds: [],
      gouCha: null,
    },
  };
}

/** Events to show with a visible state: other seats' declines vanish and a turn change names the visible current player. */
export function visibleEventsFor(events: readonly GameEvent[], visible: GameState, viewerId: PlayerId): GameEvent[] {
  return events.flatMap((event): GameEvent[] => {
    if (event.kind === 'GOUCHA_DECLINED' && event.playerId !== viewerId) return [];
    if (event.kind !== 'TURN_CHANGED') return [event];
    return visible.currentPlayer === null ? [] : [{ kind: 'TURN_CHANGED', playerId: visible.currentPlayer }];
  });
}
