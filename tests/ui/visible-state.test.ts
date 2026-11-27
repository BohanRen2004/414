import { describe, expect, it } from 'vitest';
import { Card, Rank } from '../../client/assets/scripts/core/cards/card';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { gouChaPendingFrame, hidesGouChaQuery, visibleEventsFor, visibleStateFor } from '../../client/assets/scripts/ui/visible-state';
import { c } from '../helpers/cards';
import { dispatch } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';

/** Seat 1 leads a single five; seats 2 and 3 both hold a pair, the human (seat 0) holds one five. */
function queriedAfterLead(): GameState {
  const state = buildState({
    phase: 'FREE_LEAD',
    currentPlayer: 1,
    hands: {
      0: [c('0-five', Rank.FIVE), c('0-nine', Rank.NINE)],
      1: [c('lead-five', Rank.FIVE), c('1-king', Rank.KING)],
      2: [c('2-five-a', Rank.FIVE), c('2-five-b', Rank.FIVE), c('2-ten', Rank.TEN)],
      3: [c('3-five-a', Rank.FIVE), c('3-five-b', Rank.FIVE), c('3-jack', Rank.JACK)],
    },
  });
  return dispatch(state, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['lead-five'] });
}

function declineUntilClosed(state: GameState): GameState {
  let next = state;
  while (next.phase === 'GOUCHA_QUERY') {
    next = dispatch(next, { kind: 'DECLINE_GOUCHA', playerId: next.currentPlayer! });
  }
  return next;
}

describe('state visible to one seat', () => {
  it('shows another seat\'s pending CHA query as the response that follows when nobody joins', () => {
    const queried = queriedAfterLead();
    expect(queried).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
    expect(hidesGouChaQuery(queried, 0)).toBe(true);

    const visible = visibleStateFor(queried, 0);
    expect(visible).toEqual(declineUntilClosed(queried));
    expect(visible).toMatchObject({ phase: 'RESPONDING', currentPlayer: 2, trick: { holderId: 1, nextResponder: 2, gouCha: null } });
    expect(visibleStateFor(dispatch(queried, { kind: 'DECLINE_GOUCHA', playerId: 2 }), 0)).toEqual(visible);
  });

  it('shows another seat\'s GOU query as a neutral pending frame: the chain on the table, nobody to act', () => {
    const afterCha = dispatch(queriedAfterLead(), {
      kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['2-five-a', '2-five-b'],
    });
    expect(afterCha).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 3 });

    const visible = visibleStateFor(afterCha, 0);
    expect(visible).toMatchObject({
      phase: 'GOUCHA_QUERY',
      currentPlayer: null,
      trick: { holderId: 2, nextResponder: null, passedPlayerIds: [] },
    });
    expect(visible.trick?.currentPlay).toEqual(afterCha.trick?.currentPlay);
    expect(visible.trick?.currentPlay.pattern).toEqual({ kind: 'SINGLE', rank: Rank.FIVE });
    expect(visible.trick?.gouCha).toMatchObject({
      holderId: 2, nextAddition: 'GOU', queryCursor: 2, declinedPlayerIds: [],
      additions: [{ addition: 'CHA', playerId: 2, cardIds: ['2-five-a', '2-five-b'] }],
    });
    expect(visibleStateFor(visible, 0)).toEqual(visible);
    // Which seat is being asked, and who already declined, stay hidden.
    expect(visibleStateFor(dispatch(afterCha, { kind: 'DECLINE_GOUCHA', playerId: 3 }), 1)).toEqual(visibleStateFor(afterCha, 1));
  });

  it('builds the same pending frame after a CHA whether or not anyone is then asked to GOU', () => {
    const lead = (two: readonly Card[], three: readonly Card[]) => dispatch(buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: {
        0: [c('0-nine', Rank.NINE), c('0-ten', Rank.TEN)],
        1: [c('lead-five', Rank.FIVE), c('1-king', Rank.KING)],
        2: two,
        3: three,
      },
    }), { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['lead-five'] });
    const cha = { kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['2-five-a', '2-five-b'] } as const;

    const askedQuery = lead(
      [c('2-five-a', Rank.FIVE), c('2-five-b', Rank.FIVE), c('2-jack', Rank.JACK)],
      [c('x-five', Rank.FIVE), c('3-queen', Rank.QUEEN)],
    );
    const asked = dispatch(askedQuery, cha);
    expect(asked).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 3 });

    const closedQuery = lead(
      [c('2-five-a', Rank.FIVE), c('2-five-b', Rank.FIVE), c('x-five', Rank.FIVE)],
      [c('2-jack', Rank.JACK), c('3-queen', Rank.QUEEN)],
    );
    const closed = dispatch(closedQuery, cha);
    expect(closed).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 2, trick: null });

    const publicPart = (state: GameState | null) => state === null ? null : ({
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      trick: state.trick,
      finishOrder: state.finishOrder,
      publicHistory: state.publicHistory,
      actionNumber: state.actionNumber,
      remaining: state.players.map((player) => player.hand.length),
    });
    const pendingWhenClosed = gouChaPendingFrame(closedQuery, closed);
    expect(pendingWhenClosed).not.toBeNull();
    expect(publicPart(pendingWhenClosed)).toEqual(publicPart(visibleStateFor(asked, 0)));
    expect(publicPart(gouChaPendingFrame(askedQuery, asked))).toEqual(publicPart(visibleStateFor(asked, 0)));
    expect(pendingWhenClosed?.players).toEqual(closed.players);

    // After the hidden seat declines, both worlds end the trick the same way.
    expect(publicPart(dispatch(asked, { kind: 'DECLINE_GOUCHA', playerId: 3 }))).toEqual(publicPart(closed));
  });

  it('builds a pending frame after the viewer\'s own GOU decline, and none where no CHA happened or the round ended', () => {
    const afterCha = dispatch(queriedAfterLead(), {
      kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['2-five-a', '2-five-b'],
    });
    const atViewer = dispatch(afterCha, { kind: 'DECLINE_GOUCHA', playerId: 3 });
    expect(atViewer).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 0 });
    expect(atViewer.trick?.gouCha?.declinedPlayerIds).toEqual([3]);
    expect(visibleStateFor(atViewer, 0)).toEqual({
      ...atViewer,
      trick: { ...atViewer.trick!, gouCha: { ...atViewer.trick!.gouCha!, queryCursor: 0, declinedPlayerIds: [] } },
    });
    const declined = dispatch(atViewer, { kind: 'DECLINE_GOUCHA', playerId: 0 });
    expect(declined).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 2, trick: null });
    const pending = gouChaPendingFrame(atViewer, declined);
    expect(pending).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: null, trick: { holderId: 2 } });
    expect(pending?.trick?.gouCha).toEqual(visibleStateFor(afterCha, 0).trick?.gouCha);

    const queried = queriedAfterLead();
    expect(gouChaPendingFrame(queried, dispatch(queried, { kind: 'DECLINE_GOUCHA', playerId: 2 }))).toBeNull();
    const freeLead = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: { 0: [c('f-0', Rank.NINE)], 1: [c('f-1', Rank.SIX), c('f-1b', Rank.KING)], 2: [c('f-2', Rank.TEN)], 3: [c('f-3', Rank.JACK)] },
    });
    expect(gouChaPendingFrame(freeLead, dispatch(freeLead, { kind: 'PLAY_CARDS', playerId: 1, cardIds: ['f-1'] }))).toBeNull();

    const lastCha = dispatch(buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      finishOrder: [2, 3],
      hands: {
        0: [c('end-five', Rank.FIVE), c('end-nine', Rank.NINE)],
        1: [c('end-cha-a', Rank.FIVE), c('end-cha-b', Rank.FIVE)],
        2: [],
        3: [],
      },
    }), { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['end-five'] });
    const ended = dispatch(lastCha, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['end-cha-a', 'end-cha-b'] });
    expect(ended.phase).toBe('ROUND_RESULT');
    expect(gouChaPendingFrame(lastCha, ended)).toBeNull();
  });

  it('shows the viewer its own query without earlier declines and leaves every other phase untouched', () => {
    const queried = queriedAfterLead();
    expect(visibleStateFor(queried, 2)).toEqual(queried);
    expect(hidesGouChaQuery(queried, 2)).toBe(false);

    const responding = declineUntilClosed(queried);
    expect(visibleStateFor(responding, 0)).toBe(responding);
    expect(hidesGouChaQuery(responding, 0)).toBe(false);
  });

  it('drops other seats\' declines and points turn changes at the visible current player', () => {
    const queried = queriedAfterLead();
    const visible = visibleStateFor(queried, 0);
    expect(visibleEventsFor([
      { kind: 'CARDS_PLAYED', playerId: 1, cardIds: ['lead-five'] },
      { kind: 'GOUCHA_DECLINED', playerId: 3 },
      { kind: 'GOUCHA_DECLINED', playerId: 0 },
      { kind: 'TURN_CHANGED', playerId: 3 },
    ], visible, 0)).toEqual([
      { kind: 'CARDS_PLAYED', playerId: 1, cardIds: ['lead-five'] },
      { kind: 'GOUCHA_DECLINED', playerId: 0 },
      { kind: 'TURN_CHANGED', playerId: 2 },
    ]);
  });
});
