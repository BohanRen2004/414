import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { PlayerId } from '../../client/assets/scripts/core/cards/card';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { applyAction, createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { expectSuccess } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';

function allAiGameAfter(seed: number, actions: number): GameState {
  const started = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed })).state;
  let state: GameState = {
    ...started,
    players: started.players.map((player) => ({ ...player, controlType: 'BASIC_AI' })) as unknown as GameState['players'],
  };
  for (let count = 0; count < actions; count += 1) {
    const action = chooseBasicAiAction(buildObservation(state, state.currentPlayer!));
    state = expectSuccess(applyAction(state, action)).state;
  }
  return state;
}

/** Trade the first card of two seats, keeping every public hand size unchanged. */
function swapFirstCards(state: GameState, left: PlayerId, right: PlayerId): GameState {
  const leftHand = state.players[left].hand;
  const rightHand = state.players[right].hand;
  const players = state.players.map((player) => {
    if (player.playerId === left) return { ...player, hand: [rightHand[0]!, ...leftHand.slice(1)] };
    if (player.playerId === right) return { ...player, hand: [leftHand[0]!, ...rightHand.slice(1)] };
    return player;
  }) as unknown as GameState['players'];
  return { ...state, players };
}

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

  it('stays identical when only the deal seed or other players\' cards differ', () => {
    const state = allAiGameAfter(414, 12);
    const playerId = state.currentPlayer!;
    const [left, right] = ([0, 1, 2, 3] as const).filter((seat) => seat !== playerId);
    const otherDeal = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 2026 })).state;
    const hiddenChanged: GameState = {
      ...swapFirstCards(state, left!, right!),
      rootSeed: otherDeal.rootSeed,
      randomState: otherDeal.randomState,
    };

    expect(buildObservation(hiddenChanged, playerId)).toEqual(buildObservation(state, playerId));
  });

  it('varies the tie-break value as the public history grows', () => {
    const values = [4, 5, 6, 7].map((actions) => {
      const state = allAiGameAfter(414, actions);
      return buildObservation(state, state.currentPlayer!).decisionRandom;
    });
    expect(new Set(values).size).toBe(values.length);
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
