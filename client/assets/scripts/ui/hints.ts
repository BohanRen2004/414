import { buildObservation } from '../ai/ai-observation';
import { generateCandidates } from '../ai/candidates';
import { compareCandidateScores, scoreCandidate } from '../ai/score';
import { PlayerId } from '../core/cards/card';
import { GameAction } from '../core/state/game-action';
import { GameState } from '../core/state/game-state';

/**
 * Legal moves for the hint button, best first: the play the AI would choose, then down its ranking.
 * The AI observation reads only the seat's own hand and public information, so a state whose other
 * hands are placeholders (online play) gives the same hints.
 */
export function rankedHintActions(state: GameState, playerId: PlayerId): GameAction[] {
  const observation = buildObservation(state, playerId);
  return generateCandidates(observation)
    .map((action) => ({ action, score: scoreCandidate(observation, action) }))
    .sort((left, right) => compareCandidateScores(left.score, right.score) || left.score.stableKey.localeCompare(right.score.stableKey))
    .map(({ action }) => action);
}
