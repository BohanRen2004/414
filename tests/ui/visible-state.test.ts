import { describe, expect, it } from 'vitest';
import { Rank } from '../../client/assets/scripts/core/cards/card';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { hidesGouChaQuery, visibleEventsFor, visibleStateFor } from '../../client/assets/scripts/ui/visible-state';
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

  it('shows another seat\'s pending GOU query as the aggregate bomb response', () => {
    const afterCha = dispatch(queriedAfterLead(), {
      kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['2-five-a', '2-five-b'],
    });
    expect(afterCha).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 3 });

    const visible = visibleStateFor(afterCha, 0);
    expect(visible).toEqual(declineUntilClosed(dispatch(afterCha, { kind: 'DECLINE_GOUCHA', playerId: 3 })));
    expect(visible.trick?.currentPlay).toMatchObject({
      cardIds: ['lead-five', '2-five-a', '2-five-b'],
      pattern: { kind: 'N_OF_KIND_BOMB', rank: Rank.FIVE, count: 3 },
      playerId: 2,
    });
    expect(visible).toMatchObject({ phase: 'RESPONDING', currentPlayer: 3 });
  });

  it('leaves the viewer\'s own query and every other phase untouched', () => {
    const queried = queriedAfterLead();
    expect(visibleStateFor(queried, 2)).toBe(queried);
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
