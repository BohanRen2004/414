import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { buildState } from '../helpers/state-builder';

describe('AI observation privacy', () => {
  it('copies only the acting player hand and public data', () => {
    const hands = dealFourPlayers(414).hands;
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: { 0: hands[0]!, 1: hands[1]!, 2: hands[2]!, 3: hands[3]! },
    });
    const observation = buildObservation(state, 1);

    expect(observation.ownHand.map((card) => card.id)).toEqual(state.players[1].hand.map((card) => card.id));
    expect(observation.ownHand).not.toBe(state.players[1].hand);
    expect(observation.publicPlayers.map((player) => player.remaining)).toEqual([27, 27, 27, 27]);
    expect(observation.publicPlayers.map((player) => player.teamId)).toEqual([0, 1, 0, 1]);
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain(state.players[0].hand[0]!.id);
    expect(serialized).not.toContain(state.players[2].hand[0]!.id);
    expect(serialized).not.toContain('players');
    expect(observation).not.toHaveProperty('gameState');
    expect(observation).not.toHaveProperty('randomState');
  });

  it('returns detached public history and current-play snapshots', () => {
    const hands = dealFourPlayers(414).hands;
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: { 0: hands[0]!, 1: hands[1]!, 2: hands[2]!, 3: hands[3]! },
    });
    const observation = buildObservation(state, 1);
    expect(observation.currentPlay).toBeNull();
    expect(observation.publicHistory).toEqual([]);
    expect(observation.decisionRandom).toBeGreaterThanOrEqual(0);
  });

  it('reports an invalid runtime seat ID clearly', () => {
    const hands = dealFourPlayers(414).hands;
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: { 0: hands[0]!, 1: hands[1]!, 2: hands[2]!, 3: hands[3]! },
    });
    expect(() => buildObservation(state, 4 as never)).toThrowError(
      new RangeError('playerId must be an integer seat from 0 to 3; received 4'),
    );
  });
});
