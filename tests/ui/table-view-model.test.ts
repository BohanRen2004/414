import { describe, expect, it } from 'vitest';
import { Card, PlayerId, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameResult } from '../../client/assets/scripts/core/state/game-state';
import { clearSelection, nextHint, selectRange, toggleCard } from '../../client/assets/scripts/ui/hand-selection';
import { buildTableViewModel } from '../../client/assets/scripts/ui/table-view-model';
import { buildState } from '../helpers/state-builder';
import { group, sameRank } from '../helpers/cards';

function card(id: string, rank: Rank, suit: Suit = Suit.CLUB): Card {
  return { id, deckIndex: 0, rank, suit };
}

function humanInput(selectedCardIds: readonly string[] = [], humanPlayerId: PlayerId = 0) {
  return { humanPlayerId, selectedCardIds, hintIndex: 0 } as const;
}

describe('table view model', () => {
  it('maps seats around the human and never exposes AI hands', () => {
    const state = buildState({
      phase: 'FREE_LEAD', currentPlayer: 0,
      hands: {
        0: [card('human-card', Rank.FIVE)],
        1: [card('left-secret', Rank.SIX)],
        2: [card('top-secret', Rank.SEVEN)],
        3: [card('right-secret', Rank.EIGHT)],
      },
    });
    const vm = buildTableViewModel(state, humanInput());
    expect(vm.seats.bottom.playerId).toBe(0);
    expect(vm.seats.top.playerId).toBe(2);
    expect(vm.seats.left.playerId).toBe(1);
    expect(vm.seats.right.playerId).toBe(3);
    expect(vm.seats.bottom.cards?.map((entry) => entry.id)).toEqual(['human-card']);
    expect(vm.seats.top.cards).toBeUndefined();
    expect(vm.seats.left.cards).toBeUndefined();
    expect(vm.seats.right.cards).toBeUndefined();
    expect(vm.seats.top.remaining).toBe(1);
    expect(JSON.stringify(vm)).not.toContain('top-secret');
    expect(JSON.stringify(vm)).not.toContain('left-secret');
    expect(JSON.stringify(vm)).not.toContain('right-secret');
  });

  it('shows only controls for the human and changes Pass by phase', () => {
    const freeLead = buildState({
      phase: 'FREE_LEAD', currentPlayer: 0,
      hands: { 0: [card('human', Rank.FIVE)], 1: [card('one', Rank.SIX)], 2: [card('two', Rank.SEVEN)], 3: [card('three', Rank.EIGHT)] },
    });
    const freeVm = buildTableViewModel(freeLead, humanInput());
    expect(freeVm.controls).toMatchObject({ showPlay: true, showPass: false, showHint: true, playEnabled: false });

    const responding = buildState({
      phase: 'RESPONDING', currentPlayer: 0,
      hands: { 0: [card('human-response', Rank.SIX)], 1: [card('holder', Rank.FIVE)], 2: [card('two', Rank.SEVEN)], 3: [card('three', Rank.EIGHT)] },
      currentPlay: group([card('public-five', Rank.FIVE)], 1, 1), holderId: 1,
    });
    const respondingVm = buildTableViewModel(responding, humanInput());
    expect(respondingVm.controls.showPass).toBe(true);
    expect(respondingVm.center.holderId).toBe(1);
    expect(respondingVm.center.patternLabel).toBe('单 5');

    const aiTurnVm = buildTableViewModel(freeLead, humanInput([], 2));
    expect(aiTurnVm.controls).toMatchObject({ showPlay: false, showPass: false, showHint: false, playEnabled: false });
  });

  it('reflects persistent report counts and stable Chinese pattern labels', () => {
    const tableFives = sameRank(Rank.FIVE, 3).map((entry) => ({ ...entry, id: `table:${entry.id}` }));
    const state = buildState({
      phase: 'RESPONDING', currentPlayer: 0,
      hands: { 0: [card('human', Rank.FIVE)], 1: sameRank(Rank.FIVE, 3), 2: [card('two', Rank.SEVEN)], 3: [card('three', Rank.EIGHT)] },
      currentPlay: group(tableFives, 1, 1), holderId: 1,
    });
    const vm = buildTableViewModel(state, humanInput());
    expect(vm.seats.left.reportCount).toBe(3);
    expect(vm.center.patternLabel).toBe('轰');
  });

  it('shows the current CHA/GOU prompt with the exact rank, count, and contributions', () => {
    const basePlay = group([card('base-five', Rank.FIVE)], 0, 1);
    const state = buildState({
      phase: 'GOUCHA_QUERY', currentPlayer: 1,
      hands: {
        0: [card('other-zero', Rank.SIX)],
        1: sameRank(Rank.FIVE, 2),
        2: [card('other-two', Rank.SEVEN)],
        3: [card('other-three', Rank.EIGHT)],
      },
      gouCha: {
        rank: Rank.FIVE, basePlay, additions: [], aggregateCardIds: ['base-five'],
        aggregatePattern: { kind: 'SINGLE', rank: Rank.FIVE }, holderId: 0,
        nextAddition: 'CHA', queryCursor: 0, declinedPlayerIds: [],
      },
      overrides: {
        publicHistory: [{ actionNumber: 1, playerId: 0, kind: 'PLAY_CARDS', cardIds: ['base-five'] }],
      },
    });
    const vm = buildTableViewModel(state, humanInput([], 1));
    expect(vm.gouCha).toMatchObject({ playerId: 1, addition: 'CHA', rank: Rank.FIVE, requiredCount: 2 });
    expect(vm.gouCha?.suggestedCardIds).toHaveLength(2);
    expect(vm.center.contributions).toEqual([{ playerId: 0, label: '出牌', cardIds: ['base-five'] }]);
    expect(vm.controls).toMatchObject({ showPlay: false, showPass: false, showHint: false });

    const gouBase = group([card('gou-base-five', Rank.FIVE)], 0, 1);
    const gouState = buildState({
      phase: 'GOUCHA_QUERY', currentPlayer: 2,
      hands: {
        0: [card('gou-other-zero', Rank.SIX)],
        1: [card('gou-holder', Rank.SEVEN)],
        2: [card('gou-five', Rank.FIVE)],
        3: [card('gou-other-three', Rank.EIGHT)],
      },
      gouCha: {
        rank: Rank.FIVE, basePlay: gouBase,
        additions: [{ addition: 'CHA', playerId: 1, cardIds: ['gou-cha-a', 'gou-cha-b'], actionNumber: 2 }],
        aggregateCardIds: ['gou-base-five', 'gou-cha-a', 'gou-cha-b'],
        aggregatePattern: { kind: 'N_OF_KIND_BOMB', rank: Rank.FIVE, count: 3 },
        holderId: 1, nextAddition: 'GOU', queryCursor: 1, declinedPlayerIds: [],
      },
      overrides: {
        publicHistory: [
          { actionNumber: 1, playerId: 0, kind: 'PLAY_CARDS', cardIds: ['gou-base-five'] },
          { actionNumber: 2, playerId: 1, kind: 'CHA', cardIds: ['gou-cha-a', 'gou-cha-b'] },
        ],
      },
    });
    const gouVm = buildTableViewModel(gouState, humanInput([], 2));
    expect(gouVm.gouCha).toMatchObject({ playerId: 2, addition: 'GOU', rank: Rank.FIVE, requiredCount: 1 });
    expect(gouVm.gouCha?.suggestedCardIds).toEqual(['gou-five']);
    expect(gouVm.center.contributions.map((entry) => entry.label)).toEqual(['出牌', '岔']);
  });

  it('renders closed-chain contribution history in order', () => {
    const currentPlay = group([card('agg-a', Rank.FIVE), card('agg-b', Rank.FIVE), card('agg-c', Rank.FIVE)], 2, 3);
    const state = buildState({
      phase: 'RESPONDING', currentPlayer: 0,
      hands: { 0: [card('human', Rank.SIX)], 1: [card('one', Rank.SEVEN)], 2: [card('two', Rank.EIGHT)], 3: [card('three', Rank.NINE)] },
      currentPlay, holderId: 2,
      overrides: {
        publicHistory: [
          { actionNumber: 1, playerId: 0, kind: 'PLAY_CARDS', cardIds: ['agg-a'] },
          { actionNumber: 2, playerId: 1, kind: 'CHA', cardIds: ['agg-b', 'agg-c'] },
        ],
      },
    });
    const vm = buildTableViewModel(state, humanInput());
    expect(vm.center.contributions.map((entry) => entry.label)).toEqual(['出牌', '岔']);
  });

  it('enables only a legal selected play and maps invalid reasons to stable keys', () => {
    const state = buildState({
      phase: 'FREE_LEAD', currentPlayer: 0,
      hands: { 0: [card('five-a', Rank.FIVE), card('five-b', Rank.FIVE), card('six', Rank.SIX)], 1: [], 2: [], 3: [] },
    });
    const legal = buildTableViewModel(state, humanInput(['five-a', 'five-b']));
    expect(legal.controls.playEnabled).toBe(true);
    expect(legal.controls.errorKey).toBeNull();

    const mixed = buildTableViewModel(state, humanInput(['five-a', 'six']));
    expect(mixed.controls.playEnabled).toBe(false);
    expect(mixed.controls.errorKey).toBe('pattern.mixed_ranks');

    const duplicate = buildTableViewModel(state, humanInput(['five-a', 'five-a']));
    expect(duplicate.controls.errorKey).toBe('rule.duplicate_card_id');
    expect(buildTableViewModel(state, humanInput(['not-owned'])).controls.errorKey)
      .toBe('rule.card_not_owned');
  });

  it('rejects a valid pattern that cannot beat the current response', () => {
    const state = buildState({
      phase: 'RESPONDING', currentPlayer: 0,
      hands: { 0: [card('low-three', Rank.THREE)], 1: [card('one', Rank.SEVEN)], 2: [card('two', Rank.EIGHT)], 3: [card('three', Rank.NINE)] },
      currentPlay: group([card('public-five', Rank.FIVE)], 1, 1), holderId: 1,
    });
    const vm = buildTableViewModel(state, humanInput(['low-three']));
    expect(vm.controls.playEnabled).toBe(false);
    expect(vm.controls.errorKey).toBe('rule.does_not_beat_current_play');
  });

  it('maps the public result and seed', () => {
    const result: GameResult = { finishOrder: [0, 2, 1, 3], winningTeam: 0, capturedOpponents: 2 };
    const state = buildState({
      phase: 'ROUND_RESULT', currentPlayer: null,
      hands: { 0: [], 1: [], 2: [], 3: [] },
      finishOrder: [0, 2, 1, 3],
      overrides: { result },
    });
    const vm = buildTableViewModel(state, humanInput());
    expect(vm.result).toEqual({ places: [0, 2, 1, 3], winningTeam: 0, capturedOpponents: 2, seed: 414 });
    expect(vm.controls).toMatchObject({ showPlay: false, showPass: false, showHint: false, playEnabled: false });
  });

  it('toggles only current-hand cards, removes duplicates, and keeps hand order', () => {
    const hand = [card('a', Rank.THREE), card('b', Rank.FOUR), card('c', Rank.FIVE)];
    const ui = { ...humanInput(), selectedCardIds: ['outside', 'b', 'b'] };
    const toggledOn = toggleCard(ui, 'c', hand);
    expect(toggledOn.selectedCardIds).toEqual(['b', 'c']);
    expect(toggledOn.hintIndex).toBe(0);
    const toggledOff = toggleCard(toggledOn, 'b', hand);
    expect(toggledOff.selectedCardIds).toEqual(['c']);
    expect(toggleCard(toggledOff, 'outside', hand).selectedCardIds).toEqual(['c']);
  });

  it('selects and clears inclusive ranges while filtering stale IDs', () => {
    const orderedIds = ['a', 'b', 'c', 'd'];
    const ui = { ...humanInput(), selectedCardIds: ['outside', 'a', 'a'], hintIndex: 3 };
    const selected = selectRange(ui, orderedIds, 3, 1, true);
    expect(selected.selectedCardIds).toEqual(['a', 'b', 'c', 'd']);
    expect(selected.hintIndex).toBe(0);
    const clearedRange = selectRange(selected, orderedIds, 2, 1, false);
    expect(clearedRange.selectedCardIds).toEqual(['a', 'd']);
    expect(selectRange(ui, orderedIds, -1, 99, true).selectedCardIds).toEqual(['a']);
  });

  it('clears selection and resets the hint cursor', () => {
    expect(clearSelection({ ...humanInput(['a', 'a']), hintIndex: 5 }))
      .toMatchObject({ selectedCardIds: [], hintIndex: 0 });
  });

  it('cycles unique card-bearing legal hints and handles empty or non-card candidates', () => {
    const legalPlays: GameAction[] = [
      { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['a', 'b'] },
      { kind: 'PASS', playerId: 0 },
      { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['c'] },
      { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['b', 'a'] },
    ];
    const first = nextHint(humanInput(['stale']), legalPlays);
    const second = nextHint(first, legalPlays);
    const wrapped = nextHint(second, legalPlays);
    expect(first.selectedCardIds).toEqual(['a', 'b']);
    expect(second.selectedCardIds).toEqual(['c']);
    expect(wrapped.selectedCardIds).toEqual(['a', 'b']);
    expect(new Set(wrapped.selectedCardIds).size).toBe(wrapped.selectedCardIds.length);
    expect(nextHint({ ...humanInput(['stale']), hintIndex: 7 }, []).selectedCardIds).toEqual([]);
    expect(nextHint(humanInput(['stale']), [{ kind: 'PASS', playerId: 0 }]).selectedCardIds).toEqual([]);
  });
});
