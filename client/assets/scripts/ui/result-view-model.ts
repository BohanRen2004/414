import { GameResult } from '../core/state/game-state';
import { PlayerId, TeamId } from '../core/cards/card';

export interface ResultViewModel {
  readonly places: readonly PlayerId[];
  readonly winningTeam: TeamId;
  readonly capturedOpponents: 0 | 1 | 2;
  readonly seed: number;
}

export function buildResultViewModel(result: GameResult, seed: number): ResultViewModel {
  return {
    places: [...result.finishOrder],
    winningTeam: result.winningTeam,
    capturedOpponents: result.capturedOpponents,
    seed,
  };
}
