import { describe, expect, it } from 'vitest';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { CardGroup } from '../../client/assets/scripts/core/patterns/play-pattern';
import { deriveSeed } from '../../client/assets/scripts/core/random/prng';
import { applyAction, createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { GouChaAddition } from '../../client/assets/scripts/core/state/game-state';
import { c } from '../helpers/cards';
import { errorCode, expectSuccess } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';

function group(
  cardIds: readonly string[],
  pattern: CardGroup['pattern'],
  playerId: 0 | 1 = 0,
): CardGroup {
  return { cardIds, pattern, playerId, actionNumber: 1 };
}

function chainFixture(
  basePlay: CardGroup,
  additions: readonly GouChaAddition[],
  rank: Rank = Rank.FIVE,
  aggregateCardIds: readonly string[] = [...basePlay.cardIds, ...additions.flatMap((addition) => addition.cardIds)],
) {
  return {
    rank,
    basePlay,
    additions,
    aggregateCardIds,
    aggregatePattern: { kind: 'N_OF_KIND_BOMB' as const, rank, count: aggregateCardIds.length },
    holderId: 1 as const,
    nextAddition: 'GOU' as const,
    queryCursor: 2 as const,
    declinedPlayerIds: [],
  };
}

describe('start game', () => {
  it('deals four deterministic hands and emits setup events without mutating setup', () => {
    const setup = createSetupState();
    const setupSnapshot = structuredClone(setup);
    const started = expectSuccess(applyAction(setup, { kind: 'START_GAME', seed: 414 }));

    expect(started.state.phase).toBe('FREE_LEAD');
    expect(started.state.players.map((player) => player.hand.length)).toEqual([27, 27, 27, 27]);
    expect(started.state.players.map((player) => player.teamId)).toEqual([0, 1, 0, 1]);
    expect(started.state.players.map((player) => player.controlType)).toEqual(['HUMAN', 'BASIC_AI', 'BASIC_AI', 'BASIC_AI']);
    expect(new Set(started.state.players.flatMap((player) => player.hand.map((card) => card.id))).size).toBe(108);
    expect(started.state.currentPlayer).toBe(started.state.firstPlayer);
    expect(started.state.actionNumber).toBe(1);
    expect(started.state.rootSeed).toBe(414);
    expect(started.state.randomState).toEqual({
      deal: dealFourPlayers(414).dealStateAfterSetup,
      ai: deriveSeed(414, 'AI'),
    });
    expect(started.events).toEqual([
      { kind: 'GAME_STARTED' },
      { kind: 'CARDS_DEALT' },
      { kind: 'TURN_CHANGED', playerId: started.state.firstPlayer },
    ]);

    const again = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414 }));
    expect(again.state).toEqual(started.state);
    expect(setup).toEqual(setupSnapshot);
  });

  it('rejects restarting a live game and leaves its state untouched', () => {
    const started = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414 }));
    const snapshot = structuredClone(started.state);

    expect(errorCode(applyAction(started.state, { kind: 'START_GAME', seed: 415 }))).toBe('WRONG_PHASE');
    expect(started.state).toEqual(snapshot);
  });

  it('routes actions by phase and rejects missing cards in a live state', () => {
    const setup = createSetupState();
    const built = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: { 0: [], 1: [], 2: [], 3: [] },
    });
    const actions = [
      { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['fixture'] },
      { kind: 'PASS', playerId: 0 },
      { kind: 'ADD_GOUCHA', playerId: 0, addition: 'CHA', cardIds: ['fixture-a', 'fixture-b'] },
      { kind: 'DECLINE_GOUCHA', playerId: 0 },
    ] as const;
    for (const action of actions) {
      expect(errorCode(applyAction(setup, action))).toBe('WRONG_PHASE');
    }
    expect(errorCode(applyAction(built, actions[0]!))).toBe('CARD_NOT_OWNED');
    expect(errorCode(applyAction(built, actions[1]!))).toBe('WRONG_PHASE');
    expect(errorCode(applyAction(built, actions[2]!))).toBe('WRONG_PHASE');
    expect(errorCode(applyAction(built, actions[3]!))).toBe('WRONG_PHASE');
    expect(built.phase).toBe('FREE_LEAD');
    expect(built.actionNumber).toBe(1);
  });
});

describe('state fixture card identity', () => {
  const emptyHands = { 0: [], 1: [], 2: [], 3: [] } as const;

  it('rejects a hand alias that names a different unused canonical card', () => {
    expect(() => buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: { ...emptyHands, 0: [c('0:0:0', Rank.THREE, Suit.SPADE)] },
    })).toThrow(/conflicts with its canonical card identity/);
  });

  it('rejects a table alias that names a different unused canonical card', () => {
    expect(() => buildState({
      phase: 'RESPONDING',
      currentPlayer: 1,
      hands: emptyHands,
      currentPlay: group(['0:0:0'], { kind: 'SINGLE', rank: Rank.FOUR }),
    })).toThrow(/conflicts with its canonical card identity/);
  });

  it('rejects repeated card IDs within a gou-cha addition', () => {
    const basePlay = group(['base-five'], { kind: 'SINGLE', rank: Rank.FIVE });
    const gouCha = chainFixture(basePlay, [
      { addition: 'CHA', playerId: 1, cardIds: ['same', 'same'], actionNumber: 2 },
    ]);
    expect(() => buildState({ phase: 'GOUCHA_QUERY', currentPlayer: 2, hands: emptyHands, gouCha }))
      .toThrow(/repeats a card ID/);
  });

  it('rejects a gou-cha addition that reuses a base-play card ID', () => {
    const basePlay = group(['base-five'], { kind: 'SINGLE', rank: Rank.FIVE });
    const gouCha = chainFixture(basePlay, [
      { addition: 'CHA', playerId: 1, cardIds: ['base-five', 'cha-other'], actionNumber: 2 },
    ]);
    expect(() => buildState({ phase: 'GOUCHA_QUERY', currentPlayer: 2, hands: emptyHands, gouCha }))
      .toThrow(/reuses table card ID/);
  });

  it('rejects reusing a regular 4A4 alias as a heart 4A4 in the aggregate mirror', () => {
    const cardIds = ['four-a', 'four-b', 'ace'];
    const regular = group(cardIds, { kind: 'FOUR_A_FOUR', allHearts: false });
    const heart = group(cardIds, { kind: 'FOUR_A_FOUR', allHearts: true }, 1);
    const gouCha = chainFixture(regular, [], Rank.FOUR, cardIds);
    expect(() => buildState({
      phase: 'GOUCHA_QUERY',
      currentPlayer: 2,
      hands: emptyHands,
      currentPlay: heart,
      gouCha,
    })).toThrow(/conflicts with its prior rank or suit/);
  });
});
