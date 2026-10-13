import { PlayerId } from '../core/cards/card';
import { nextActivePlayer } from '../core/rules/normal-trick';
import { GameEvent } from '../core/state/game-event';
import { GameState, GouChaAddition, GouChaChain } from '../core/state/game-state';

/**
 * True while the rules core asks another seat about gou-cha. Who is asked depends on hidden hands, so
 * the viewer must not be able to tell that a query is happening at all.
 */
export function hidesGouChaQuery(state: GameState, viewerId: PlayerId): boolean {
  return state.phase === 'GOUCHA_QUERY' && state.currentPlayer !== viewerId;
}

/** The chain as every seat sees it: which seat is being asked and who already declined stay private. */
function publicChain(chain: GouChaChain): GouChaChain {
  return { ...chain, queryCursor: chain.holderId, declinedPlayerIds: [] };
}

/**
 * The neutral frame after a public CHA/GOU: the single and every CHA/GOU card on the table, the last
 * contributor holding, and nobody to act. It is the same whether anybody is then asked to continue
 * or the chain is already dead.
 */
function pendingView(state: GameState, chain: GouChaChain): GameState {
  return {
    ...state,
    phase: 'GOUCHA_QUERY',
    currentPlayer: null,
    trick: {
      currentPlay: chain.basePlay,
      holderId: chain.holderId,
      nextResponder: null,
      passedPlayerIds: [],
      gouCha: publicChain(chain),
    },
  };
}

/**
 * The state as one seat may see it; states without a gou-cha query are returned as is, and the viewer's
 * own query only loses who declined before it.
 * Another seat's query on a single nobody has CHA'd yet looks like the ordinary response it closes into
 * when nobody joins: the single on the table and the seat after its player to respond. Once a CHA has
 * happened, another seat's query looks like the neutral pending frame.
 */
export function visibleStateFor(state: GameState, viewerId: PlayerId): GameState {
  const chain = state.trick?.gouCha;
  if (state.trick === null || chain === null || chain === undefined) return state;
  if (!hidesGouChaQuery(state, viewerId)) {
    // The viewer's own prompt: it may know it is being asked, not who declined before it.
    return { ...state, trick: { ...state.trick, gouCha: { ...chain, queryCursor: viewerId, declinedPlayerIds: [] } } };
  }
  if (chain.additions.length > 0) return pendingView(state, chain);
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

/**
 * The pending frame to show for one transition out of a gou-cha query, built from the public part of
 * `before` and `after`: after a CHA/GOU, or after the viewer's own decline once a CHA has happened. The
 * rules core may already have closed the chain and reset the trick (nobody could continue), so the frame
 * is rebuilt from the chain in `before` plus the new public CHA/GOU record. Returns null when there is
 * nothing pending to show: no CHA has happened yet, the transition did not leave a query, or the round ended.
 */
export function gouChaPendingFrame(before: GameState, after: GameState): GameState | null {
  const chain = before.trick?.gouCha;
  if (before.phase !== 'GOUCHA_QUERY' || chain === null || chain === undefined || after.phase === 'ROUND_RESULT') {
    return null;
  }
  const additions: GouChaAddition[] = [...chain.additions];
  for (const record of after.publicHistory.slice(before.publicHistory.length)) {
    if (record.kind !== 'CHA' && record.kind !== 'GOU') return null;
    additions.push({ addition: record.kind, playerId: record.playerId, cardIds: [...record.cardIds], actionNumber: record.actionNumber });
  }
  const latest = additions[additions.length - 1];
  if (latest === undefined) return null;
  return pendingView(after, {
    ...chain,
    additions,
    holderId: latest.playerId,
    nextAddition: latest.addition === 'CHA' ? 'GOU' : 'CHA',
  });
}

/** Events to show with a visible state: other seats' declines vanish and a turn change names the visible current player. */
export function visibleEventsFor(events: readonly GameEvent[], visible: GameState, viewerId: PlayerId): GameEvent[] {
  return events.flatMap((event): GameEvent[] => {
    if (event.kind === 'GOUCHA_DECLINED' && event.playerId !== viewerId) return [];
    if (event.kind !== 'TURN_CHANGED') return [event];
    return visible.currentPlayer === null ? [] : [{ kind: 'TURN_CHANGED', playerId: visible.currentPlayer }];
  });
}
