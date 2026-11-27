import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { PlayerId } from '../../client/assets/scripts/core/cards/card';
import { applyAction, createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { buildTableViewModel } from '../../client/assets/scripts/ui/table-view-model';

function start(seed: number, deckCount: 1 | 2): GameState {
  const result = applyAction(createSetupState(), { kind: 'START_GAME', seed, deckCount });
  if (!result.ok) throw new Error(result.error.code);
  return result.state;
}

function step(state: GameState): GameState {
  const action = chooseBasicAiAction(buildObservation(state, state.currentPlayer!));
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(result.error.code);
  return result.state;
}

const view = (state: GameState, seat: PlayerId = 0) => buildTableViewModel(state, { humanPlayerId: seat, selectedCardIds: [], hintIndex: 0 });

describe('seat actions and the card counter', () => {
  it.each([1, 2] as const)('shows what each seat did in the current trick, and nothing once it resets (%i deck)', (deckCount) => {
    let state = start(7, deckCount);
    let checkedPass = false;
    let checkedReset = false;
    for (let turn = 0; turn < 3000 && state.phase !== 'ROUND_RESULT'; turn += 1) {
      const before = state;
      state = step(state);
      const vm = view(state);
      const actions = Object.values(vm.seatActions);
      if (state.trick === null) {
        expect(actions.every((action) => action === null)).toBe(true);
        checkedReset = true;
        continue;
      }
      // The play to beat is marked once, at its owner's seat, unless a gou-cha chain is running.
      const leading = actions.filter((action) => action?.leading === true);
      expect(leading.length).toBe(state.trick.gouCha === null ? 1 : 0);
      const last = state.publicHistory[state.publicHistory.length - 1]!;
      if (last.kind === 'PASS' && before.trick !== null && state.publicHistory.length > before.publicHistory.length) {
        const seat = Object.entries(vm.seats).find(([, s]) => s?.playerId === last.playerId)![0] as keyof typeof vm.seatActions;
        expect(vm.seatActions[seat]).toMatchObject({ kind: 'PASS', label: '不出' });
        checkedPass = true;
      }
    }
    expect(checkedPass && checkedReset).toBe(true);
  });

  it.each([1, 2] as const)('counts exactly the cards the other seats still hold (%i deck)', (deckCount) => {
    let state = start(11, deckCount);
    for (let turn = 0; turn < 3000 && state.phase !== 'ROUND_RESULT'; turn += 1) {
      const vm = view(state, 2);
      const unseen = vm.cardCounter.reduce((sum, entry) => sum + entry.unseen, 0);
      const others = state.players.filter((player) => player.playerId !== 2).reduce((sum, player) => sum + player.hand.length, 0);
      expect(unseen).toBe(others);
      state = step(state);
    }
    expect(view(start(11, deckCount)).cardCounter.map((entry) => entry.label).slice(0, 3)).toEqual(['大王', '小王', '2']);
  });
});
