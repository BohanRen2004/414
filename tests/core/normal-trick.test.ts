import { describe, expect, it } from 'vitest';
import { PlayerId, Rank } from '../../client/assets/scripts/core/cards/card';
import { CardGroup } from '../../client/assets/scripts/core/patterns/play-pattern';
import { applyAction } from '../../client/assets/scripts/core/rules/reducer';
import { c } from '../helpers/cards';
import { dispatch, errorCode, expectSuccess } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';

const hands = {
  0: [c('3a', Rank.THREE), c('9a', Rank.NINE)],
  1: [c('3b', Rank.THREE), c('4a', Rank.FOUR)],
  2: [c('5a', Rank.FIVE)],
  3: [c('6a', Rank.SIX)],
} as const;
const orderedRanks = [Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT] as const;

function currentSingle(id: string, rank: Rank, playerId: PlayerId): CardGroup {
  return { cardIds: [id], pattern: { kind: 'SINGLE', rank }, playerId, actionNumber: 1 };
}

function responseState(overrides: Partial<Parameters<typeof buildState>[0]> = {}) {
  return buildState({
    phase: 'RESPONDING',
    currentPlayer: 1,
    hands,
    currentPlay: currentSingle('table3', Rank.THREE, 0),
    holderId: 0,
    ...overrides,
  });
}

describe('normal play', () => {
  it('accepts a free lead and records immutable state and public history', () => {
    const state = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands });
    const before = structuredClone(state);
    const result = expectSuccess(applyAction(state, { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['3a'] }));

    expect(result.state.phase).toBe('RESPONDING');
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.trick?.holderId).toBe(0);
    expect(result.state.trick?.currentPlay).toMatchObject({ cardIds: ['3a'], pattern: { kind: 'SINGLE', rank: Rank.THREE } });
    expect(result.state.players[0].hand.map((card) => card.id)).toEqual(['9a']);
    expect(result.state.publicHistory).toEqual([
      { actionNumber: 1, playerId: 0, kind: 'PLAY_CARDS', cardIds: ['3a'] },
    ]);
    expect(result.events).toContainEqual({ kind: 'CARDS_PLAYED', playerId: 0, cardIds: ['3a'] });
    expect(state).toEqual(before);
  });

  it.each([
    { start: 4, remaining: 3 },
    { start: 3, remaining: 2 },
    { start: 2, remaining: 1 },
  ])('reports exactly $remaining remaining card(s)', ({ start, remaining }) => {
    const playerHand = orderedRanks.slice(0, start).map((rank, index) => c(`report-${start}-${index}`, rank));
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: playerHand,
        1: [c(`report-other-${start}-1`, Rank.KING)],
        2: [c(`report-other-${start}-2`, Rank.QUEEN)],
        3: [c(`report-other-${start}-3`, Rank.JACK)],
      },
    });
    const cardId = playerHand[0]!.id;
    const outcome = expectSuccess(applyAction(state, { kind: 'PLAY_CARDS', playerId: 0, cardIds: [cardId] }));

    expect(outcome.events).toEqual([
      { kind: 'CARDS_PLAYED', playerId: 0, cardIds: [cardId] },
      { kind: 'PLAYER_REPORTED', playerId: 0, remaining },
      { kind: 'TURN_CHANGED', playerId: 1 },
    ]);
    expect(outcome.state.players[0].lastReportedCount).toBe(remaining);
  });

  it('does not report while more than three cards remain', () => {
    const playerHand = orderedRanks.map((rank, index) => c(`unreported-${index}`, rank));
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: playerHand,
        1: [c('unreported-other-1', Rank.KING)],
        2: [c('unreported-other-2', Rank.QUEEN)],
        3: [c('unreported-other-3', Rank.JACK)],
      },
    });
    const cardId = playerHand[0]!.id;
    const outcome = expectSuccess(applyAction(state, { kind: 'PLAY_CARDS', playerId: 0, cardIds: [cardId] }));

    expect(outcome.events).toEqual([
      { kind: 'CARDS_PLAYED', playerId: 0, cardIds: [cardId] },
      { kind: 'TURN_CHANGED', playerId: 1 },
    ]);
    expect(outcome.state.players[0].lastReportedCount).toBeNull();
  });

  it('checks actor, phase, ownership, duplicate IDs, pattern, and comparison', () => {
    const free = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands });
    expect(errorCode(applyAction(free, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['3b'] }))).toBe('NOT_CURRENT_PLAYER');
    expect(errorCode(applyAction(free, { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['missing'] }))).toBe('CARD_NOT_OWNED');
    expect(errorCode(applyAction(free, { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['3a', '3a'] }))).toBe('DUPLICATE_CARD_ID');
    expect(errorCode(applyAction(free, { kind: 'PLAY_CARDS', playerId: 0, cardIds: [] }))).toBe('INVALID_PATTERN');

    const responding = responseState();
    expect(errorCode(applyAction(responding, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['3b'] }))).toBe('DOES_NOT_BEAT_CURRENT_PLAY');
    expect(errorCode(applyAction(responding, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['3b', '4a'] }))).toBe('INVALID_PATTERN');
    expect(errorCode(applyAction(responding, { kind: 'PASS', playerId: 1 }))).toBeNull();
    expect(errorCode(applyAction(responseState({ currentPlayer: 0 }), { kind: 'PASS', playerId: 0 }))).toBe('PASS_NOT_ALLOWED');
    expect(errorCode(applyAction(free, { kind: 'PASS', playerId: 0 }))).toBe('WRONG_PHASE');
  });

  it('allows a higher-ranked pair to beat a pair on the table', () => {
    const pairHands = {
      0: [c('4x', Rank.FOUR)],
      1: [c('5a', Rank.FIVE), c('5b', Rank.FIVE)],
      2: [c('6x', Rank.SIX)],
      3: [c('7x', Rank.SEVEN)],
    } as const;
    const pair = buildState({
      phase: 'RESPONDING',
      currentPlayer: 1,
      hands: pairHands,
      currentPlay: { cardIds: ['old-a', 'old-b'], pattern: { kind: 'PAIR', rank: Rank.FOUR }, playerId: 0, actionNumber: 1 },
      holderId: 0,
    });
    const next = dispatch(pair, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['5a', '5b'] });
    expect(next.trick?.holderId).toBe(1);
    expect(next.trick?.passedPlayerIds).toEqual([]);
  });

  it('clears ordinary passes after a successful response', () => {
    const state = responseState({ currentPlayer: 3, passedPlayerIds: [2] });
    const afterPlay = dispatch(state, { kind: 'PLAY_CARDS', playerId: 3, cardIds: ['6a'] });
    expect(afterPlay.trick?.passedPlayerIds).toEqual([]);
    expect(afterPlay.trick?.holderId).toBe(3);
    expect(afterPlay.currentPlayer).toBe(0);
  });

  it('offers a previously passed seat another response after the table changes', () => {
    const afterPass = dispatch(responseState(), { kind: 'PASS', playerId: 1 });
    expect(afterPass.currentPlayer).toBe(2);
    const afterSeat2Pass = dispatch(afterPass, { kind: 'PASS', playerId: 2 });
    expect(afterSeat2Pass.currentPlayer).toBe(3);
    const afterSeat3Beats = dispatch(afterSeat2Pass, { kind: 'PLAY_CARDS', playerId: 3, cardIds: ['6a'] });
    expect(afterSeat3Beats.currentPlayer).toBe(0);
    expect(afterSeat3Beats.trick?.passedPlayerIds).toEqual([]);
    expect(afterSeat3Beats.trick?.holderId).toBe(3);
  });

  it('resets after every other active player passes and returns the lead to the trick winner', () => {
    const lead = dispatch(responseState(), { kind: 'PASS', playerId: 1 });
    const pass2 = dispatch(lead, { kind: 'PASS', playerId: 2 });
    const finalPass = expectSuccess(applyAction(pass2, { kind: 'PASS', playerId: 3 }));
    const reset = finalPass.state;
    expect(reset.phase).toBe('FREE_LEAD');
    expect(reset.currentPlayer).toBe(0);
    expect(reset.trick).toBeNull();
    expect(finalPass.events).toContainEqual({ kind: 'TRICK_RESET' });
  });

  it('skips finished seats for response and lends a finished winner\'s lead to their partner', () => {
    const state = responseState({
      currentPlayer: 2,
      finishOrder: [1],
      hands: { ...hands, 1: [] },
    });
    expect(state.players[1].finishPlace).toBe(1);
    const afterPlay = dispatch(state, { kind: 'PLAY_CARDS', playerId: 2, cardIds: ['5a'] });
    expect(afterPlay.currentPlayer).toBe(3);

    const resetFixture = responseState({
      currentPlayer: 1,
      finishOrder: [3],
      hands: { 0: [c('8a', Rank.EIGHT)], 1: [c('8b', Rank.EIGHT)], 2: [c('8c', Rank.EIGHT)], 3: [] },
      currentPlay: currentSingle('table-five', Rank.FIVE, 3),
      holderId: 3,
      passedPlayerIds: [],
    });
    const reset = dispatch(
      dispatch(dispatch(resetFixture, { kind: 'PASS', playerId: 1 }), { kind: 'PASS', playerId: 2 }),
      { kind: 'PASS', playerId: 0 },
    );
    expect(reset.phase).toBe('FREE_LEAD');
    expect(reset.currentPlayer).toBe(1);
  });

  it('gives a finished winner\'s lead to the next active seat when their partner has also finished', () => {
    const state = responseState({
      currentPlayer: 2,
      finishOrder: [3, 1],
      hands: { 0: [c('9x', Rank.NINE)], 1: [], 2: [c('9y', Rank.NINE)], 3: [] },
      currentPlay: currentSingle('table-six', Rank.SIX, 3),
      holderId: 3,
      passedPlayerIds: [],
    });
    const reset = dispatch(dispatch(state, { kind: 'PASS', playerId: 2 }), { kind: 'PASS', playerId: 0 });
    expect(reset.phase).toBe('FREE_LEAD');
    expect(reset.currentPlayer).toBe(0);
  });

  it('records a player who uses their final card and immediately fills fourth place', () => {
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: [c('last', Rank.ACE)],
        1: [],
        2: [],
        3: [c('remaining', Rank.TWO)],
      },
      finishOrder: [1, 2],
    });
    const outcome = expectSuccess(applyAction(state, { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['last'] }));
    const result = outcome.state;
    expect(result.players[0].finishPlace).toBe(3);
    expect(result.players[3].finishPlace).toBe(4);
    expect(result.finishOrder).toEqual([1, 2, 0, 3]);
    expect(result.phase).toBe('ROUND_RESULT');
    expect(result.currentPlayer).toBeNull();
    expect(result.result).toMatchObject({ winningTeam: 1, capturedOpponents: 0 });
    expect(outcome.events).toContainEqual({ kind: 'PLAYER_FINISHED', playerId: 0, place: 3 });
    expect(outcome.events).toContainEqual({ kind: 'PLAYER_FINISHED', playerId: 3, place: 4 });
    expect(outcome.events).toContainEqual({ kind: 'ROUND_FINISHED' });
  });
});
