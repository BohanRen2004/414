import { PlayerId, TeamId } from '../cards/card';
import { GameResult } from '../state/game-state';

export function buildResult(finishOrder: readonly PlayerId[]): GameResult {
  const validSeats = new Set<PlayerId>([0, 1, 2, 3]);
  if (
    finishOrder.length !== 4
    || new Set(finishOrder).size !== 4
    || finishOrder.some((playerId) => !validSeats.has(playerId))
  ) {
    throw new RangeError('A result requires four unique players in finish order');
  }

  const order = [...finishOrder] as unknown as readonly [PlayerId, PlayerId, PlayerId, PlayerId];
  const winningTeam = (order[0] % 2) as TeamId;
  const secondTeammatePlace = order.findIndex((playerId) => playerId !== order[0] && playerId % 2 === winningTeam);
  const capturedOpponents = order.filter(
    (playerId, index) => playerId % 2 !== winningTeam && index > secondTeammatePlace,
  ).length as 0 | 1 | 2;

  return { finishOrder: order, winningTeam, capturedOpponents };
}
