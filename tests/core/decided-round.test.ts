import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { applyAction, createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { GameState } from '../../client/assets/scripts/core/state/game-state';

describe('a decided round ends at once', () => {
  it.each([1, 2] as const)('never asks one team to play on alone (%i deck)', (deckCount) => {
    let endedEarly = 0;
    for (let game = 0; game < 300; game += 1) {
      const started = applyAction(createSetupState(), { kind: 'START_GAME', seed: (0x9e3779b1 * (game + 1)) >>> 0, deckCount });
      if (!started.ok) throw new Error(started.error.code);
      let state: GameState = started.state;
      while (state.phase !== 'ROUND_RESULT') {
        const teams = new Set(state.players.filter((player) => player.hand.length > 0 && player.finishPlace === null).map((player) => player.teamId));
        expect(teams.size).toBe(2);
        const result = applyAction(state, chooseBasicAiAction(buildObservation(state, state.currentPlayer!)));
        if (!result.ok) throw new Error(result.error.code);
        state = result.state;
      }
      expect(state.finishOrder).toHaveLength(4);
      if (state.players.filter((player) => player.hand.length > 0).length >= 2) endedEarly += 1;
    }
    // Both opponents going out first happens in a fair share of games.
    expect(endedEarly).toBeGreaterThan(10);
  });
});
