import { Card } from '../core/cards/card';
import { GameAction } from '../core/state/game-action';
import { HumanUiState } from './table-view-model';

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function handIds(hand: readonly Card[]): string[] {
  return uniqueIds(hand.map((card) => card.id));
}

function orderedSelection(selectedIds: readonly string[], availableIds: readonly string[]): string[] {
  const selected = new Set(selectedIds);
  return uniqueIds(availableIds).filter((id) => selected.has(id));
}

/** Toggle one card; stale selections are pruned and output follows hand order. */
export function toggleCard(ui: HumanUiState, cardId: string, hand: readonly Card[]): HumanUiState {
  const available = handIds(hand);
  const selected = new Set(orderedSelection(ui.selectedCardIds, available));
  if (available.includes(cardId)) {
    if (selected.has(cardId)) selected.delete(cardId);
    else selected.add(cardId);
  }
  return { ...ui, selectedCardIds: available.filter((id) => selected.has(id)), hintIndex: 0 };
}

/** Select or clear the inclusive index range in the supplied hand order. */
export function selectRange(
  ui: HumanUiState,
  orderedIds: readonly string[],
  from: number,
  to: number,
  selected: boolean,
): HumanUiState {
  const available = uniqueIds(orderedIds);
  const chosen = new Set(orderedSelection(ui.selectedCardIds, available));
  const validIndices = Number.isInteger(from) && Number.isInteger(to)
    && from >= 0 && to >= 0 && from < available.length && to < available.length;
  if (validIndices) {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    for (let index = start; index <= end; index += 1) {
      const id = available[index]!;
      if (selected) chosen.add(id);
      else chosen.delete(id);
    }
  }
  return { ...ui, selectedCardIds: available.filter((id) => chosen.has(id)), hintIndex: 0 };
}

/**
 * Selection while dragging across the hand from card `from` to card `to` (indices into `orderedIds`, the
 * hand as shown). The first card decides the direction: starting on an unselected card selects the whole
 * span, starting on a selected card clears it. Cards outside the span keep their `base` selection, so
 * dragging back shrinks the span again.
 */
export function dragSelection(
  base: readonly string[],
  orderedIds: readonly string[],
  from: number,
  to: number,
): string[] {
  const first = orderedIds[from];
  if (first === undefined) return [...base];
  const ui: HumanUiState = { humanPlayerId: 0, selectedCardIds: base, hintIndex: 0 };
  const result = selectRange(ui, orderedIds, from, to, !base.includes(first)).selectedCardIds;
  // Keep selected cards that are not in `orderedIds` (e.g. not draggable right now) as they were.
  const outside = base.filter((id) => !orderedIds.includes(id));
  return [...outside, ...result];
}

export function clearSelection(ui: HumanUiState): HumanUiState {
  return { ...ui, selectedCardIds: [], hintIndex: 0 };
}

function hintedIds(action: GameAction): readonly string[] | null {
  if (action.kind === 'PLAY_CARDS' || action.kind === 'ADD_GOUCHA') return action.cardIds;
  return null;
}

/**
 * Cycle card-bearing candidates generated for this player's current hand;
 * PASS/DECLINE remain button actions and are intentionally skipped.
 */
export function nextHint(ui: HumanUiState, legalPlays: readonly GameAction[]): HumanUiState {
  const distinct = new Map<string, readonly string[]>();
  for (const action of legalPlays) {
    const ids = hintedIds(action);
    if (ids === null || ids.length === 0) continue;
    const unique = uniqueIds(ids);
    const key = `${action.kind}:${[...unique].sort().join('|')}`;
    distinct.set(key, unique);
  }
  const hints = [...distinct.values()];
  if (hints.length === 0) return clearSelection(ui);

  const start = Number.isSafeInteger(ui.hintIndex) && ui.hintIndex >= 0 ? ui.hintIndex % hints.length : 0;
  return {
    ...ui,
    selectedCardIds: [...hints[start]!],
    hintIndex: (start + 1) % hints.length,
  };
}
