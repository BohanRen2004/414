import { describe, expect, it } from 'vitest';
import { PlayerId, Rank } from '../../client/assets/scripts/core/cards/card';
import { GameResult } from '../../client/assets/scripts/core/state/game-state';
import { buildDeclineAction, buildGouChaAction } from '../../client/assets/scripts/ui/goucha-actions';
import { buildResultViewModel } from '../../client/assets/scripts/ui/result-view-model';
import { GouChaPromptViewModel } from '../../client/assets/scripts/ui/table-view-model';

function prompt(addition: 'CHA' | 'GOU', playerId: PlayerId = 2): GouChaPromptViewModel {
  const requiredCount = addition === 'CHA' ? 2 : 1;
  return {
    playerId,
    addition,
    rank: Rank.FIVE,
    requiredCount,
    suggestedCardIds: addition === 'CHA' ? ['five-a', 'five-b'] : ['five-c'],
    eligibleCardIds: addition === 'CHA'
      ? ['five-a', 'five-b', 'five-c', 'five-d']
      : ['five-c', 'five-d'],
  };
}

describe('pure gou-cha and result action mappings', () => {
  it('builds CHA with exactly two eligible same-rank physical cards, including non-suggested cards', () => {
    expect(buildGouChaAction(prompt('CHA'), ['five-c', 'five-d'])).toEqual({
      kind: 'ADD_GOUCHA', playerId: 2, addition: 'CHA', cardIds: ['five-c', 'five-d'],
    });
  });

  it('builds GOU with one eligible same-rank physical card, including a non-suggested alternative', () => {
    expect(buildGouChaAction(prompt('GOU'), ['five-d'])).toEqual({
      kind: 'ADD_GOUCHA', playerId: 2, addition: 'GOU', cardIds: ['five-d'],
    });
  });

  it('rejects count, duplicate, rank-suggestion, and invalid prompt mismatches', () => {
    expect(() => buildGouChaAction(prompt('CHA'), ['five-a'])).toThrowError(/CHA requires exactly 2/);
    expect(() => buildGouChaAction(prompt('CHA'), ['five-a', 'five-a'])).toThrowError(/must be unique/);
    expect(() => buildGouChaAction(prompt('GOU'), ['six-a'])).toThrowError(/match the active rank/);
    expect(() => buildGouChaAction({ ...prompt('GOU'), requiredCount: 2 }, ['five-c']))
      .toThrowError(/GOU requires exactly 1/);
    expect(() => buildGouChaAction({ ...prompt('CHA'), eligibleCardIds: ['five-a'] }, ['five-a', 'five-b']))
      .toThrowError(/prompt must contain at least 2 unique eligible/);
    expect(() => buildGouChaAction({ ...prompt('CHA'), suggestedCardIds: ['five-a', 'five-a'] }, ['five-a', 'five-b']))
      .toThrowError(/suggested eligible/);
    expect(() => buildGouChaAction({ ...prompt('CHA'), playerId: 4 as PlayerId }, ['five-a', 'five-b']))
      .toThrowError(/playerId must be an integer seat/);
    expect(() => buildGouChaAction({ ...prompt('CHA'), rank: 99 as Rank }, ['five-a', 'five-b']))
      .toThrowError(/prompt rank is invalid/);
  });

  it('builds a player-specific decline action', () => {
    expect(buildDeclineAction(3)).toEqual({ kind: 'DECLINE_GOUCHA', playerId: 3 });
    expect(() => buildDeclineAction(4 as PlayerId)).toThrowError(/playerId must be an integer seat/);
  });

  it('copies all result places and maps team, capture count, and seed', () => {
    const result: GameResult = {
      finishOrder: [2, 0, 3, 1],
      winningTeam: 0,
      capturedOpponents: 1,
    };
    const view = buildResultViewModel(result, 414);
    expect(view).toEqual({ places: [2, 0, 3, 1], winningTeam: 0, capturedOpponents: 1, seed: 414 });
    expect(view.places).not.toBe(result.finishOrder);
  });
});
