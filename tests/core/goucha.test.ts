import { describe, expect, it } from 'vitest';
import { Rank, Suit } from '../../client/assets/scripts/core/cards/card';
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
    holderId: 0,
    nextAddition: 'CHA',
    queryCursor: 0,
    declinedPlayerIds: [],
    ...overrides,
  };
}

/** Every card the chain has put on the table, in contribution order. */
function chainCardIds(state: GameState): string[] {
  const chain = state.trick?.gouCha;
  if (chain === null || chain === undefined) throw new Error('expected an active gou-cha chain');
  return [...chain.basePlay.cardIds, ...chain.additions.flatMap((addition) => addition.cardIds)];
}

function expectRejectedWithoutMutation(state: GameState, action: GameAction, code: RuleErrorCode): void {
  const before = structuredClone(state);
  expect(errorCode(applyAction(state, action))).toBe(code);
  expect(state).toEqual(before);
  expect(state.publicHistory).toEqual(before.publicHistory);
  expect(state.actionNumber).toBe(before.actionNumber);
}

describe('corrected single-card gou-cha', () => {
  it('runs single 5 → pair 5 CHA → single 5 GOU → pair CHA → single GOU, then stops at the 7-card maximum', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      // The eighth five stays in seat 1's hand: a CHA needs two, so nobody can ever add an eighth card.
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-last-five', Rank.FIVE), c('1-ten', Rank.TEN)],
      2: [c('2-gou', Rank.FIVE), c('2-jack', Rank.JACK)],
      3: [c('3-cha-a', Rank.FIVE), c('3-cha-b', Rank.FIVE), c('3-queen', Rank.QUEEN)],
    });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 1 });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 0, nextAddition: 'CHA' });

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 1, nextAddition: 'GOU' });
    expect(chainCardIds(state)).toHaveLength(3);

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 2, nextAddition: 'CHA' });
    expect(chainCardIds(state)).toHaveLength(4);

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 3, addition: 'CHA', cardIds: ['3-cha-a', '3-cha-b'] });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 3, nextAddition: 'GOU' });
    expect(chainCardIds(state)).toHaveLength(6);
    expect(state.currentPlayer).toBe(0);

    const finalGou = expectSuccess(applyAction(state, { kind: 'ADD_GOUCHA', playerId: 0, addition: 'GOU', cardIds: ['0-five'] }));
    // Dead chain: nobody can CHA a seventh five, so the trick ends at once and the last adder leads.
    expect(finalGou.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 0, trick: null });
    expect(finalGou.events).toEqual([
      { kind: 'GOUCHA_ADDED', playerId: 0, addition: 'GOU', cardIds: ['0-five'] },
      { kind: 'PLAYER_REPORTED', playerId: 0, remaining: 1 },
      { kind: 'TRICK_RESET' },
      { kind: 'TURN_CHANGED', playerId: 0 },
    ]);
    expect(finalGou.state.publicHistory.map((record) => [record.playerId, record.kind, record.cardIds])).toEqual([
      [0, 'PLAY_CARDS', ['lead-five']],
      [1, 'CHA', ['1-cha-a', '1-cha-b']],
      [2, 'GOU', ['2-gou']],
      [3, 'CHA', ['3-cha-a', '3-cha-b']],
      [0, 'GOU', ['0-five']],
    ]);
    expect(finalGou.state.players[0].hand.map((card) => card.id)).toEqual(['0-nine']);
    expect(finalGou.state.players[1].hand.map((card) => card.id)).toEqual(['1-last-five', '1-ten']);
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
      1: [],
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
    expect(state.trick?.gouCha?.declinedPlayerIds).toEqual([1]);

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
    expect(state.publicHistory.map((record) => record.kind)).toEqual(['PLAY_CARDS']);
  });

  it('keeps a decline private: no public record and no action number', () => {
    const queried = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-nine', Rank.NINE)],
      2: [c('2-cha-a', Rank.FIVE), c('2-cha-b', Rank.FIVE), c('2-ten', Rank.TEN)],
      3: [c('3-jack', Rank.JACK)],
    });
    const declined = expectSuccess(applyAction(queried, { kind: 'DECLINE_GOUCHA', playerId: 1 }));
    expect(declined.state.publicHistory).toEqual(queried.publicHistory);
    expect(declined.state.actionNumber).toBe(queried.actionNumber);
    expect(declined.state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
    expect(declined.events).toEqual([
      { kind: 'GOUCHA_DECLINED', playerId: 1 },
      { kind: 'TURN_CHANGED', playerId: 2 },
    ]);

    const added = dispatch(declined.state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['2-cha-a', '2-cha-b'] });
    expect(added.publicHistory).toEqual([
      { actionNumber: 1, playerId: 0, kind: 'PLAY_CARDS', cardIds: ['lead-five'] },
      { actionNumber: 2, playerId: 2, kind: 'CHA', cardIds: ['2-cha-a', '2-cha-b'] },
    ]);
    expect(added.actionNumber).toBe(3);
    expect(added.trick?.gouCha?.additions.map((addition) => addition.actionNumber)).toEqual([2]);
  });

  it('leaves the same public state whether or not a hidden seat was asked and declined', () => {
    const asked = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-six', Rank.SIX), c('1-seven', Rank.SEVEN)],
      2: [c('2-five-a', Rank.FIVE), c('2-five-b', Rank.FIVE), c('2-ten', Rank.TEN)],
      3: [c('3-jack', Rank.JACK)],
    });
    expect(asked).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
    const afterDecline = dispatch(asked, { kind: 'DECLINE_GOUCHA', playerId: 2 });
    const neverAsked = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-six', Rank.SIX), c('1-seven', Rank.SEVEN)],
      2: [c('2-five-a', Rank.FIVE), c('2-six', Rank.SIX), c('2-ten', Rank.TEN)],
      3: [c('3-jack', Rank.JACK)],
    });
    expect(neverAsked.phase).toBe('RESPONDING');

    const publicPart = (state: GameState) => ({
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      trick: state.trick,
      publicHistory: state.publicHistory,
      actionNumber: state.actionNumber,
      remaining: state.players.map((player) => player.hand.length),
    });
    expect(publicPart(afterDecline)).toEqual(publicPart(neverAsked));
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
      finishOrder: [1],
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
    expect(chainCardIds(result.state)).toEqual(['lead-five', '1-cha-a', '1-cha-b']);
    expect(result.state.trick?.currentPlay.pattern).toEqual({ kind: 'SINGLE', rank: Rank.FIVE });
    expect(result.events).toContainEqual({ kind: 'GOUCHA_ADDED', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(result.events).toContainEqual({ kind: 'PLAYER_FINISHED', playerId: 1, place: 3 });
    expect(result.events).toContainEqual({ kind: 'ROUND_FINISHED' });
    expect(result.events).not.toContainEqual({ kind: 'TRICK_RESET' });
  });

  it('finishes a last-card CHA while keeping its cards in the chain', () => {
    const state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [c('2-gou', Rank.FIVE), c('2-six', Rank.SIX)],
      3: [c('3-seven', Rank.SEVEN)],
    });
    const result = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(result.players[1].finishPlace).toBe(1);
    expect(chainCardIds(result)).toEqual(['lead-five', '1-cha-a', '1-cha-b']);
    expect(result.trick?.holderId).toBe(1);
    expect(result).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
  });

  it('finishes a last-card GOU, then ends the dead chain and lends the lead to the GOU player\'s partner', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-six', Rank.SIX)],
      2: [c('2-gou', Rank.FIVE)],
      3: [c('3-seven', Rank.SEVEN)],
    });
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    const result = expectSuccess(applyAction(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] }));
    expect(result.state.players[2].finishPlace).toBe(1);
    expect(result.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 0, trick: null });
    expect(result.events).toEqual([
      { kind: 'GOUCHA_ADDED', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] },
      { kind: 'PLAYER_FINISHED', playerId: 2, place: 1 },
      { kind: 'TRICK_RESET' },
      { kind: 'TURN_CHANGED', playerId: 0 },
    ]);
  });
});

describe('dead gou-cha (死岔/死勾): a chain with a CHA ends the trick when it stops', () => {
  it('ends the trick at once when nobody can GOU a CHA, and the CHA player leads; nobody may respond', () => {
    const hands = {
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-ten', Rank.TEN)],
      2: [c('2-jack', Rank.JACK), c('2-king-a', Rank.KING), c('2-king-b', Rank.KING), c('2-king-c', Rank.KING)],
      3: [c('3-four-a', Rank.FOUR), c('3-four-b', Rank.FOUR), c('3-ace', Rank.ACE), c('3-queen', Rank.QUEEN)],
    } as const;
    const query = startSingleFive(hands);
    expect(query).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 1 });

    const cha = expectSuccess(applyAction(query, {
      kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'],
    }));
    expect(cha.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 1, trick: null });
    expect(cha.events).toEqual([
      { kind: 'GOUCHA_ADDED', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] },
      { kind: 'PLAYER_REPORTED', playerId: 1, remaining: 1 },
      { kind: 'TRICK_RESET' },
      { kind: 'TURN_CHANGED', playerId: 1 },
    ]);
    expect(cha.state.publicHistory.map((record) => record.kind)).toEqual(['PLAY_CARDS', 'CHA']);

    // Nobody gets to beat the dead CHA: not with a bomb, not with 4A4, and there is nothing to pass on.
    expectRejectedWithoutMutation(cha.state, { kind: 'PLAY_CARDS', playerId: 3, cardIds: ['3-four-a', '3-four-b', '3-ace'] }, 'NOT_CURRENT_PLAYER');
    expectRejectedWithoutMutation(cha.state, { kind: 'PLAY_CARDS', playerId: 2, cardIds: ['2-king-a', '2-king-b', '2-king-c'] }, 'NOT_CURRENT_PLAYER');
    expectRejectedWithoutMutation(cha.state, { kind: 'PASS', playerId: 1 }, 'WRONG_PHASE');
    expectRejectedWithoutMutation(cha.state, { kind: 'PASS', playerId: 2 }, 'WRONG_PHASE');
    // The CHA player starts a fresh trick with any lead; it does not have to beat anything.
    const lead = dispatch(cha.state, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['1-ten'] });
    expect(lead.trick?.currentPlay).toMatchObject({ cardIds: ['1-ten'], playerId: 1, pattern: { kind: 'SINGLE', rank: Rank.TEN } });
  });

  it('ends the trick when every eligible seat declines the GOU, with the decline left private', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-ten', Rank.TEN)],
      2: [c('2-five', Rank.FIVE), c('2-jack', Rank.JACK)],
      3: [c('3-queen', Rank.QUEEN)],
    });
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
    const declined = expectSuccess(applyAction(state, { kind: 'DECLINE_GOUCHA', playerId: 2 }));
    expect(declined.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 1, trick: null });
    expect(declined.events).toEqual([
      { kind: 'GOUCHA_DECLINED', playerId: 2 },
      { kind: 'TRICK_RESET' },
      { kind: 'TURN_CHANGED', playerId: 1 },
    ]);
    expect(declined.state.publicHistory).toEqual(state.publicHistory);
    expect(declined.state.actionNumber).toBe(state.actionNumber);
  });

  it('gives the lead to the GOU player when nobody can CHA after a GOU', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-ten', Rank.TEN)],
      2: [c('2-gou', Rank.FIVE), c('2-jack', Rank.JACK)],
      3: [c('3-queen', Rank.QUEEN)],
    });
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
    const gou = expectSuccess(applyAction(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] }));
    expect(gou.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 2, trick: null });
    expect(gou.events.slice(-2)).toEqual([{ kind: 'TRICK_RESET' }, { kind: 'TURN_CHANGED', playerId: 2 }]);
  });

  it('lets the original single player GOU after someone else\'s CHA and then lead', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-ten', Rank.TEN)],
      2: [c('2-jack', Rank.JACK)],
      3: [c('3-queen', Rank.QUEEN)],
    });
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 0 });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 1, nextAddition: 'GOU' });
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 0, addition: 'GOU', cardIds: ['0-five'] });
    expect(state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 0, trick: null });
  });

  it('lends the lead to the partner when the final adder went out on the addition (借光)', () => {
    const state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [c('2-six', Rank.SIX)],
      3: [c('3-seven', Rank.SEVEN), c('3-eight', Rank.EIGHT)],
    });
    const cha = expectSuccess(applyAction(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] }));
    expect(cha.state.players[1].finishPlace).toBe(1);
    expect(cha.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 3, trick: null });
    expect(cha.events).toEqual([
      { kind: 'GOUCHA_ADDED', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] },
      { kind: 'PLAYER_FINISHED', playerId: 1, place: 1 },
      { kind: 'TRICK_RESET' },
      { kind: 'TURN_CHANGED', playerId: 3 },
    ]);
  });

  it('passes the lead clockwise when the final adder and their partner are both out', () => {
    const state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE)],
      2: [c('2-six', Rank.SIX), c('2-seven', Rank.SEVEN)],
      3: [],
    }, [3]);
    const cha = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(cha.players[1].finishPlace).toBe(2);
    expect(cha).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 2, trick: null });
  });

  it('keeps the base single as the current play during the chain: CHA/GOU cards are never merged into a bomb', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-ten', Rank.TEN)],
      2: [c('2-gou', Rank.FIVE), c('2-jack', Rank.JACK)],
      3: [c('3-cha-a', Rank.FIVE), c('3-cha-b', Rank.FIVE), c('3-queen', Rank.QUEEN)],
    });
    const base = state.trick!.currentPlay;
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(state.trick?.currentPlay).toEqual(base);
    expect(state.trick?.holderId).toBe(1);
    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] });
    expect(state.trick?.currentPlay).toEqual(base);
    expect(state.trick?.currentPlay.pattern).toEqual({ kind: 'SINGLE', rank: Rank.FIVE });
    expect(state.trick?.gouCha).toMatchObject({ holderId: 2, nextAddition: 'CHA' });
    expect(state.trick?.gouCha).not.toHaveProperty('aggregatePattern');
    expect(state.trick?.gouCha).not.toHaveProperty('aggregateCardIds');
    expect(chainCardIds(state)).toEqual(['lead-five', '1-cha-a', '1-cha-b', '2-gou']);
  });

  it('accepts no response, bomb, or 4A4 while a chain is being asked', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-cha-a', Rank.FIVE), c('1-cha-b', Rank.FIVE), c('1-small', Rank.SMALL_JOKER, Suit.JOKER), c('1-big', Rank.BIG_JOKER, Suit.JOKER)],
      2: [c('2-gou', Rank.FIVE), c('2-four-a', Rank.FOUR), c('2-four-b', Rank.FOUR), c('2-ace', Rank.ACE)],
      3: [c('3-king-a', Rank.KING), c('3-king-b', Rank.KING), c('3-king-c', Rank.KING), c('3-king-d', Rank.KING)],
    });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 1 });
    expectRejectedWithoutMutation(state, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['1-small', '1-big'] }, 'WRONG_PHASE');
    expectRejectedWithoutMutation(state, { kind: 'PASS', playerId: 1 }, 'WRONG_PHASE');

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['1-cha-a', '1-cha-b'] });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
    expectRejectedWithoutMutation(state, { kind: 'PLAY_CARDS', playerId: 2, cardIds: ['2-four-a', '2-four-b', '2-ace'] }, 'WRONG_PHASE');
    expectRejectedWithoutMutation(state, { kind: 'PLAY_CARDS', playerId: 3, cardIds: ['3-king-a', '3-king-b', '3-king-c', '3-king-d'] }, 'WRONG_PHASE');
    expectRejectedWithoutMutation(state, { kind: 'PASS', playerId: 2 }, 'WRONG_PHASE');

    state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['2-gou'] });
    expect(state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 2, trick: null });
    expectRejectedWithoutMutation(state, { kind: 'PLAY_CARDS', playerId: 3, cardIds: ['3-king-a', '3-king-b', '3-king-c', '3-king-d'] }, 'NOT_CURRENT_PLAYER');
    expectRejectedWithoutMutation(state, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['1-small', '1-big'] }, 'NOT_CURRENT_PLAYER');
  });

  it('keeps ordinary responding on a single that nobody CHAs: higher singles and bombs still beat it', () => {
    let state = startSingleFive({
      0: [c('lead-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('1-five-a', Rank.FIVE), c('1-five-b', Rank.FIVE), c('1-six', Rank.SIX)],
      2: [c('2-four-a', Rank.FOUR), c('2-four-b', Rank.FOUR), c('2-ace', Rank.ACE), c('2-jack', Rank.JACK)],
      3: [c('3-queen', Rank.QUEEN)],
    });
    expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 1 });
    state = dispatch(state, { kind: 'DECLINE_GOUCHA', playerId: 1 });
    expect(state).toMatchObject({ phase: 'RESPONDING', currentPlayer: 1, trick: { holderId: 0, gouCha: null } });
    state = dispatch(state, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['1-six'] });
    expect(state).toMatchObject({ phase: 'RESPONDING', currentPlayer: 2, trick: { holderId: 1 } });
    state = dispatch(state, { kind: 'PLAY_CARDS', playerId: 2, cardIds: ['2-four-a', '2-four-b', '2-ace'] });
    expect(state.trick?.currentPlay.pattern).toEqual({ kind: 'FOUR_A_FOUR', allHearts: false });
  });
});
