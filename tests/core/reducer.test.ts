import { describe, expect, it } from 'vitest';
import { DeckCount, dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { firstPlayerCandidates } from '../../client/assets/scripts/core/rules/first-player';
import { CardGroup } from '../../client/assets/scripts/core/patterns/play-pattern';
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
) {
  return {
    rank,
    basePlay,
    additions,
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

    expect(setup.deckCount).toBeNull();
    expect(started.state.phase).toBe('FREE_LEAD');
    expect(started.state.deckCount).toBe(2);
    expect(started.state.players.map((player) => player.hand.length)).toEqual([27, 27, 27, 27]);
    expect(started.state.players.map((player) => player.teamId)).toEqual([0, 1, 0, 1]);
    expect(started.state.players.map((player) => player.controlType)).toEqual(['HUMAN', 'BASIC_AI', 'BASIC_AI', 'BASIC_AI']);
    expect(new Set(started.state.players.flatMap((player) => player.hand.map((card) => card.id))).size).toBe(108);
    expect(started.state.currentPlayer).toBe(started.state.firstPlayer);
    expect(started.state.actionNumber).toBe(1);
    expect(started.state.rootSeed).toBe(414);
    expect(started.state.randomState).toEqual({ deal: dealFourPlayers(414).dealStateAfterSetup });
    expect(started.events).toEqual([
      { kind: 'GAME_STARTED' },
      { kind: 'CARDS_DEALT' },
      { kind: 'TURN_CHANGED', playerId: started.state.firstPlayer },
    ]);

    const again = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414 }));
    expect(again.state).toEqual(started.state);
    expect(setup).toEqual(setupSnapshot);
    // Omitting the deck count is the two-deck game, so existing callers keep their games.
    const explicit = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414, deckCount: 2 }));
    expect(explicit.state).toEqual(started.state);
    expect(started.state.firstPlayer).toBe(dealFourPlayers(414).firstPlayer);
  });

  it('starts a one-deck game: 54 cards, 14/14/13/13, the heart-three holder leads, same seed same game', () => {
    for (const seed of [414, 0, 1, 2026, 0xffff_ffff]) {
      const started = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed, deckCount: 1 }));
      const deal = dealFourPlayers(seed, 1);
      const state = started.state;
      expect(state.deckCount).toBe(1);
      expect(state.phase).toBe('FREE_LEAD');
      expect(state.rootSeed).toBe(seed);
      expect(state.players.map((player) => player.hand)).toEqual(deal.hands);
      expect([...state.players.map((player) => player.hand.length)].sort()).toEqual([13, 13, 14, 14]);
      const ids = state.players.flatMap((player) => player.hand.map((card) => card.id));
      expect(new Set(ids).size).toBe(54);
      const heartThree = state.players.findIndex((player) =>
        player.hand.some((card) => card.rank === Rank.THREE && card.suit === Suit.HEART));
      expect(state.firstPlayer).toBe(heartThree);
      expect(state.currentPlayer).toBe(heartThree);
      expect(state.randomState).toEqual({ deal: deal.dealStateAfterSetup });
      expect(started.events).toEqual([
        { kind: 'GAME_STARTED' },
        { kind: 'CARDS_DEALT' },
        { kind: 'TURN_CHANGED', playerId: heartThree },
      ]);
      const again = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed, deckCount: 1 }));
      expect(again.state).toEqual(state);
    }
  });

  it('rejects an unknown deck count and stays in setup', () => {
    const setup = createSetupState();
    for (const deckCount of [0, 3, 1.5]) {
      expect(errorCode(applyAction(setup, { kind: 'START_GAME', seed: 414, deckCount: deckCount as DeckCount })))
        .toBe('INVALID_DECK_COUNT');
    }
    expect(setup).toEqual(createSetupState());
  });

  it('lets the first player lead any legal pattern, not only one holding a three', () => {
    for (const deckCount of [1, 2] as const) {
      for (const seed of [414, 7, 99]) {
        const state = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed, deckCount })).state;
        const leader = state.currentPlayer!;
        expect(firstPlayerCandidates(state.players.map((player) => player.hand))).toContain(leader);
        const notThree = state.players[leader].hand.find((card) => card.rank !== Rank.THREE)!;
        const led = expectSuccess(applyAction(state, { kind: 'PLAY_CARDS', playerId: leader, cardIds: [notThree.id] }));
        expect(led.state.publicHistory).toEqual([
          { actionNumber: 1, playerId: leader, kind: 'PLAY_CARDS', cardIds: [notThree.id] },
        ]);
      }
    }
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

  it('rejects reusing a regular 4A4 alias as a heart 4A4 in the current-play mirror of a chain base', () => {
    const cardIds = ['four-a', 'four-b', 'ace'];
    const regular = group(cardIds, { kind: 'FOUR_A_FOUR', allHearts: false });
    const heart = group(cardIds, { kind: 'FOUR_A_FOUR', allHearts: true }, 1);
    const gouCha = chainFixture(regular, [], Rank.FOUR);
    expect(() => buildState({
      phase: 'GOUCHA_QUERY',
      currentPlayer: 2,
      hands: emptyHands,
      currentPlay: heart,
      gouCha,
    })).toThrow(/conflicts with its prior rank or suit/);
  });
});
