import { describe, expect, it } from 'vitest';
import { Rank } from '../../client/assets/scripts/core/cards/card';
import { applyAction } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameState, GouChaChain } from '../../client/assets/scripts/core/state/game-state';
import { RuleErrorCode } from '../../client/assets/scripts/core/state/rule-error';
import { c } from '../helpers/cards';
import { dispatch, errorCode, expectSuccess } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';

function startSingleFive(hands: Parameters<typeof buildState>[0]['hands'], finishOrder: readonly (0 | 1 | 2 | 3)[] = []) {
  const state = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands, finishOrder });
  return dispatch(state, { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['lead-five'] });
}

function chainFixture(overrides: Partial<GouChaChain> = {}): GouChaChain {
  const basePlay = {
    cardIds: ['table-five'],
    pattern: { kind: 'SINGLE' as const, rank: Rank.FIVE },
    playerId: 0 as const,
    actionNumber: 1,
  };
  return {
    rank: Rank.FIVE,
    basePlay,
    additions: [],
    aggregateCardIds: ['table-five'],
    aggregatePattern: { kind: 'SINGLE', rank: Rank.FIVE },
    holderId: 0,
    nextAddition: 'CHA',
    queryCursor: 0,
    declinedPlayerIds: [],
    ...overrides,
  };
}

function expectRejectedWithoutMutation(state: GameState, action: GameAction, code: RuleErrorCode): void {
  const before = structuredClone(state);
  expect(errorCode(applyAction(state, action))).toBe(code);
  expect(state).toEqual(before);
  expect(state.publicHistory).toEqual(before.publicHistory);
  expect(state.actionNumber).toBe(before.actionNumber);
}

describe('corrected single-card gou-cha', () => {
  it('runs single 5 → pair 5 CHA → single 5 GOU → pair CHA → single GOU', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-ten', Rank.TEN)],
      2: [c('2-gou', Rank.FIVE), c('2-jack', Rank.JACK)],
      3: [c('3-cha-a', Rank.FIVE), c('3-cha-b', Rank.FIVE), c('3-queen', Rank.QUEEN)],
    });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 1 });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 0, nextAddition: 'CHA' });

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 1, nextAddition: 'GOU', aggregateCardIds: expect.any(Array) });
    expect(state.trick?.gouCha?.aggregateCardIds).toHaveLength(3);

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 2, nextAddition: 'CHA' });
    expect(state.trick?.gouCha?.aggregateCardIds).toHaveLength(4);

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 3, addition: 'CHA', cardIds: ['3-cha-a', '3-cha-b'] });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 3, nextAddition: 'GOU' });
    expect(state.trick?.gouCha?.aggregateCardIds).toHaveLength(6);

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 0, addition: 'GOU', cardIds: ['0-five'] });
    expect(state.phase).toBe('RESPONDING');
    expect(state.trick?.gouCha).toBeNull();
    expect(state.trick?.currentPlay).toMatchObject({
      cardIds: ['lead-five', '1-cha-a', '1-cha-b', '2-gou', '3-cha-a', '3-cha-b', '0-five'],
      pattern: { kind: 'N_OF_KIND_BOMB', rank: Rank.FIVE, count: 7 },
      playerId: 0,
    });
    expect(state.players[0].hand.map((card) => card.id)).toEqual(['0-nine']);
  });

  it('does not start from a pair or any straight/bomb pattern', () => {
    const hands = {
      0: [c('pair-a', Rank.FIVE), c('pair-b', Rank.FIVE)],
      1: [c('5-a', Rank.FIVE), c('5-b', Rank.FIVE)],
      2: [c('other-1', Rank.NINE)],
      3: [c('other-2', Rank.TEN)],
    } as const;
    const pair = dispatch(buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands }), {
      kind: 'PLAY_CARDS', playerId: 0, cardIds: ['pair-a', 'pair-b'],
    });
    expect(pair.phase).toBe('RESPONDING');
    expect(pair.trick?.gouCha).toBeNull();

    const straightHands = {
      0: [c('s3', Rank.THREE), c('s4', Rank.FOUR), c('s5', Rank.FIVE)],
      1: [c('5c-a', Rank.FIVE), c('5c-b', Rank.FIVE)],
      2: [c('other-3', Rank.NINE)],
      3: [c('other-4', Rank.TEN)],
    } as const;
    const straight = dispatch(buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands: straightHands }), {
      kind: 'PLAY_CARDS', playerId: 0, cardIds: ['s3', 's4', 's5'],
    });
    expect(straight.phase).toBe('RESPONDING');
    expect(straight.trick?.gouCha).toBeNull();

    const bombHands = {
      0: [c('b-a', Rank.FIVE), c('b-b', Rank.FIVE), c('b-c', Rank.FIVE)],
      1: [c('5d-a', Rank.FIVE), c('5d-b', Rank.FIVE)],
      2: [c('other-5', Rank.NINE)],
      3: [c('other-6', Rank.TEN)],
    } as const;
    const bomb = dispatch(buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands: bombHands }), {
      kind: 'PLAY_CARDS', playerId: 0, cardIds: ['b-a', 'b-b', 'b-c'],
    });
    expect(bomb.phase).toBe('RESPONDING');
    expect(bomb.trick?.gouCha).toBeNull();

    const noPair = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('single-five', Rank.FIVE)],
      2: [c('other-7', Rank.SIX)],
      3: [c('other-8', Rank.TEN)],
    });
    expect(noPair.phase).toBe('RESPONDING');
    expect(noPair.trick?.gouCha).toBeNull();
  });

  it('automatically skips finished and rank-ineligible seats in clockwise order', () => {
    const state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('finished-a', Rank.FIVE), c('finished-b', Rank.FIVE)],
      2: [c('ineligible', Rank.SIX)],
      3: [c('eligible-a', Rank.FIVE), c('eligible-b', Rank.FIVE)],
    }, [1]);
    expect(state.phase).toBe('GOUCHA_QUERY');
    expect(state.currentPlayer).toBe(3);
  });

  it('restarts scanning after each holder and asks a prior decliner on the next stage', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-nine', Rank.NINE)],
      2: [c('2-cha-a', Rank.FIVE), c('2-cha-b', Rank.FIVE), c('2-ten', Rank.TEN)],
      3: [c('3-gou', Rank.FIVE), c('3-jack', Rank.JACK)],
    });
    state = dispatch(state, { kind: 'DECLINE_GOUCHA', playerId: 1 });
    expect(state.currentPlayer).toBe(2);
    expect(state.trick?.passedPlayerIds).toEqual([]);
    expect(state.publicHistory[state.publicHistory.length - 1]).toMatchObject({ kind: 'DECLINE_GOUCHA', playerId: 1, cardIds: [] });

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['2-cha-a', '2-cha-b'] });
    expect(state.currentPlayer).toBe(3);
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 3, addition: 'GOU', cardIds: ['3-gou'] });
    expect(state.currentPlayer).toBe(1);
    expect(state.trick?.gouCha?.declinedPlayerIds).toEqual([]);
  });

  it('closes after every eligible player declines and starts ordinary response after the holder', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [c('2-six', Rank.SIX)],
      3: [c('3-seven', Rank.SEVEN)],
    });
    state = dispatch(state, { kind: 'DECLINE_GOUCHA', playerId: 1 });
    expect(state.phase).toBe('RESPONDING');
    expect(state.currentPlayer).toBe(1);
    expect(state.trick?.gouCha).toBeNull();
    expect(state.trick?.currentPlay).toMatchObject({ pattern: { kind: 'SINGLE', rank: Rank.FIVE } });
    expect(state.trick?.passedPlayerIds).toEqual([]);
    expect(state.publicHistory.map((record) => record.kind)).toEqual(['PLAY_CARDS', 'DECLINE_GOUCHA']);
  });

  it('rejects wrong stage, count, rank, and self-add without changing the source state', () => {
    const state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-nine', Rank.NINE)],
      2: [c('2-ten', Rank.TEN)],
      3: [c('3-jack', Rank.JACK)],
    });
    expectRejectedWithoutMutation(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'GOU', cardIds: ['1-cha-a'] }, 'WRONG_GOUCHA_STEP');
    expectRejectedWithoutMutation(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a'] }, 'GOUCHA_COUNT_MISMATCH');
    expectRejectedWithoutMutation(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-nine'] }, 'GOUCHA_RANK_MISMATCH');
    const selfQuery = {
      ...state,
      currentPlayer: 0 as const,
      trick: { ...state.trick!, gouCha: chainFixture() },
    };
    expectRejectedWithoutMutation(selfQuery, { kind: 'ADD_GOUCHA', playerId: 0, addition: 'CHA', cardIds: ['lead-five', '0-nine'] }, 'SELF_GOUCHA_FORBIDDEN');
  });

  it('rejects ADD and DECLINE actions by phase, actor, duplicates, ownership, or inactive status without mutation', () => {
    const free = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: [c('free-five', Rank.FIVE)],
        1: [c('free-cha-a', Rank.FIVE), c('free-cha-b', Rank.FIVE)],
        2: [c('free-other-a', Rank.SEVEN), c('free-other-b', Rank.EIGHT)],
        3: [c('free-other-c', Rank.NINE)],
      },
    });
    expectRejectedWithoutMutation(free, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['free-cha-a', 'free-cha-b'] }, 'WRONG_PHASE');
    expectRejectedWithoutMutation(free, { kind: 'DECLINE_GOUCHA', playerId: 0 }, 'WRONG_PHASE');

    const query = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [c('2-cha-a', Rank.FIVE), c('2-cha-b', Rank.FIVE)],
      3: [c('3-queen', Rank.QUEEN)],
    });
    expect(query.currentPlayer).toBe(1);
    expectRejectedWithoutMutation(query, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['2-cha-a', '2-cha-b'] }, 'NOT_CURRENT_PLAYER');
    expectRejectedWithoutMutation(query, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-a'] }, 'DUPLICATE_CARD_ID');
    expectRejectedWithoutMutation(query, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['missing-a', 'missing-b'] }, 'CARD_NOT_OWNED');
    expectRejectedWithoutMutation(query, { kind: 'DECLINE_GOUCHA', playerId: 2 }, 'NOT_CURRENT_PLAYER');

    const finishedActor: GameState = {
      ...query,
      players: [
        query.players[0],
        { ...query.players[1], finishPlace: 1 },
        query.players[2],
        query.players[3],
      ],
    };
    expectRejectedWithoutMutation(finishedActor, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] }, 'NOT_CURRENT_PLAYER');
  });

  it('records a final-card CHA contribution and immediately ends when one player remains', () => {
    const state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [],
      3: [],
    }, [2, 3]);
    const result = expectSuccess(applyAction(state, {
      kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'],
    }));
    expect(result.state.phase).toBe('ROUND_RESULT');
    expect(result.state.players[1].finishPlace).toBe(3);
    expect(result.state.players[0].finishPlace).toBe(4);
    expect(result.state.trick?.gouCha?.aggregateCardIds).toEqual(['lead-five', '1-cha-a', '1-cha-b']);
    expect(result.events).toContainEqual({ kind: 'GOUCHA_ADDED', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(result.events).toContainEqual({ kind: 'PLAYER_FINISHED', playerId: 1, place: 3 });
    expect(result.events).toContainEqual({ kind: 'ROUND_FINISHED' });
  });

  it('finishes a last-card CHA while keeping its cards in the chain aggregate', () => {
    const state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [c('2-gou', Rank.FIVE), c('2-six', Rank.SIX)],
      3: [c('3-seven', Rank.SEVEN)],
    });
    const result = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(result.players[1].finishPlace).toBe(1);
    expect(result.trick?.gouCha?.aggregateCardIds).toEqual(['lead-five', '1-cha-a', '1-cha-b']);
    expect(result.trick?.holderId).toBe(1);
  });

  it('finishes a last-card GOU while keeping its card in the chain aggregate', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [c('2-gou', Rank.FIVE)],
      3: [c('3-seven', Rank.SEVEN)],
    });
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    const result = expectSuccess(applyAction(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] }));
    expect(result.state.players[2].finishPlace).toBe(2);
    expect(result.state.trick?.gouCha).toBeNull();
    expect(result.state.trick?.currentPlay).toMatchObject({
      cardIds: ['lead-five', '1-cha-a', '1-cha-b', '2-gou'],
      pattern: { kind: 'N_OF_KIND_BOMB', rank: Rank.FIVE, count: 4 },
    });
    expect(result.events).toContainEqual({ kind: 'PLAYER_FINISHED', playerId: 2, place: 2 });
  });
});
