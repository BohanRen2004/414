import { PlayerId, TeamId } from '../cards/card';
import { PlayerCount } from '../cards/deck';
import { GameResult } from '../state/game-state';

export function buildResult(finishOrder: readonly PlayerId[], playerCount: PlayerCount = 4): GameResult {
  if (
    finishOrder.length !== playerCount
    || new Set(finishOrder).size !== playerCount
    || finishOrder.some((playerId) => !Number.isInteger(playerId) || playerId < 0 || playerId >= playerCount)
  ) {
    throw new RangeError(`A result requires ${playerCount} unique players in finish order`);
  }
  // Two or three players play alone: the first one out wins and nobody is caught.
  if (playerCount !== 4) return { finishOrder: [...finishOrder], winningTeam: finishOrder[0]! as TeamId, capturedOpponents: 0 };

  const order = [...finishOrder] as unknown as readonly [PlayerId, PlayerId, PlayerId, PlayerId];
  const winningTeam = (order[0] % 2) as TeamId;
  const secondTeammatePlace = order.findIndex((playerId) => playerId !== order[0] && playerId % 2 === winningTeam);
  const capturedOpponents = order.filter(
    (playerId, index) => playerId % 2 !== winningTeam && index > secondTeammatePlace,
  ).length as 0 | 1 | 2;

  return { finishOrder: order, winningTeam, capturedOpponents };
}
