import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { createDeck, dealPlayers } from '../../client/assets/scripts/core/cards/deck';
import { applyAction, createSetupState, setInvariantAssertionsEnabled } from '../../client/assets/scripts/core/rules/reducer';
import { GameState } from '../../client/assets/scripts/core/state/game-state';

setInvariantAssertionsEnabled(true);

function start(seed: number, playerCount: 2 | 3, deckCount?: 1 | 2) {
  return applyAction(createSetupState(), { kind: 'START_GAME', seed, playerCount, ...(deckCount === undefined ? {} : { deckCount }) });
}

describe('two and three players', () => {
  it('deals 18 each to three players and 22 each to two, setting 10 aside', () => {
    for (let seed = 1; seed < 30; seed += 1) {
      const three = dealPlayers(seed, 1, 3);
      expect(three.hands.map((hand) => hand.length)).toEqual([18, 18, 18, 0]);
      expect(three.buried).toHaveLength(0);
      const two = dealPlayers(seed, 1, 2);
      expect(two.hands.map((hand) => hand.length)).toEqual([22, 22, 0, 0]);
      expect(two.buried).toHaveLength(10);
      const all = [...two.hands.flat(), ...two.buried].map((card) => card.id).sort();
      expect(all).toEqual(createDeck(1).map((card) => card.id).sort());
      expect(two.firstPlayer).toBeLessThan(2);
      expect(three.firstPlayer).toBeLessThan(3);
    }
  });

  it('only plays fewer than four with one deck, everyone on their own', () => {
    const result = start(5, 3);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state).toMatchObject({ playerCount: 3, deckCount: 1 });
    expect(result.state.players.map((player) => player.teamId)).toEqual([0, 1, 2, 3]);
    const rejected = start(5, 3, 2);
    expect(rejected.ok).toBe(false);
    expect(applyAction(createSetupState(), { kind: 'START_GAME', seed: 1, playerCount: 5 as never }).ok).toBe(false);
  });

  it.each([2, 3] as const)('plays %i-player games to the end: empty seats never act, the first out wins', (playerCount) => {
    let earlyEnds = 0;
    for (let game = 0; game < 120; game += 1) {
      const started = start((0x9e3779b1 * (game + 1)) >>> 0, playerCount);
      if (!started.ok) throw new Error(started.error.code);
      let state: GameState = started.state;
      while (state.phase !== 'ROUND_RESULT') {
        expect(state.currentPlayer).toBeLessThan(playerCount);
        const result = applyAction(state, chooseBasicAiAction(buildObservation(state, state.currentPlayer!)));
        if (!result.ok) throw new Error(result.error.code);
        state = result.state;
      }
      expect(state.finishOrder).toHaveLength(playerCount);
      expect(state.result).toMatchObject({ winningTeam: state.finishOrder[0], capturedOpponents: 0 });
      expect(state.players.slice(playerCount).every((player) => player.finishPlace === null && player.hand.length === 0)).toBe(true);
      if (state.publicHistory.some((record) => record.kind === 'CHA')) earlyEnds += 1;
    }
    // Gou-cha still happens at small tables.
    expect(earlyEnds).toBeGreaterThan(0);
  });
});
