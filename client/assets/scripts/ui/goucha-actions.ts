import { PlayerId, Rank } from '../core/cards/card';
import { GameAction } from '../core/state/game-action';
import { GouChaPromptViewModel } from './table-view-model';

function assertPlayerId(playerId: number): asserts playerId is PlayerId {
  if (!Number.isInteger(playerId) || playerId < 0 || playerId > 3) {
    throw new RangeError(`playerId must be an integer seat from 0 to 3; received ${String(playerId)}`);
  }
}

function expectedCount(addition: 'CHA' | 'GOU'): 1 | 2 {
  return addition === 'CHA' ? 2 : 1;
}

/** Construct the exact legal addition represented by the active prompt. */
export function buildGouChaAction(
  prompt: GouChaPromptViewModel,
  selectedIds: readonly string[],
): Extract<GameAction, { kind: 'ADD_GOUCHA' }> {
  assertPlayerId(prompt.playerId);
  if (!Number.isInteger(prompt.rank) || prompt.rank < Rank.THREE || prompt.rank > Rank.BIG_JOKER) {
    throw new RangeError(`prompt rank is invalid: ${String(prompt.rank)}`);
  }
  if (prompt.addition !== 'CHA' && prompt.addition !== 'GOU') {
    throw new RangeError(`prompt addition must be CHA or GOU; received ${String(prompt.addition)}`);
  }
  const count = expectedCount(prompt.addition);
  if (prompt.requiredCount !== count) {
    throw new RangeError(`${prompt.addition} requires exactly ${count} card(s); prompt specified ${String(prompt.requiredCount)}`);
  }
  if (new Set(prompt.eligibleCardIds).size !== prompt.eligibleCardIds.length
    || prompt.eligibleCardIds.length < count) {
    throw new RangeError(`prompt must contain at least ${count} unique eligible card ID(s) of rank ${prompt.rank}`);
  }
  if (new Set(prompt.suggestedCardIds).size !== prompt.suggestedCardIds.length
    || prompt.suggestedCardIds.length !== count
    || prompt.suggestedCardIds.some((id) => !prompt.eligibleCardIds.includes(id))) {
    throw new RangeError(`prompt must contain exactly ${count} unique suggested eligible card ID(s) of rank ${prompt.rank}`);
  }
  if (selectedIds.length !== count) {
    throw new RangeError(`${prompt.addition} requires exactly ${count} selected card(s); received ${selectedIds.length}`);
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new RangeError('selected gou-cha card IDs must be unique');
  }
  const eligible = new Set(prompt.eligibleCardIds);
  if (selectedIds.some((id) => !eligible.has(id))) {
    throw new RangeError(`selected cards must match the active rank ${prompt.rank} eligibility`);
  }
  return {
    kind: 'ADD_GOUCHA',
    playerId: prompt.playerId,
    addition: prompt.addition,
    cardIds: [...selectedIds],
  };
}

export function buildDeclineAction(playerId: PlayerId): Extract<GameAction, { kind: 'DECLINE_GOUCHA' }> {
  assertPlayerId(playerId);
  return { kind: 'DECLINE_GOUCHA', playerId };
}
