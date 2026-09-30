import { GameAction } from '../core/state/game-action';
import { generateCandidates } from './candidates';
import { AiObservation } from './ai-observation';
import { compareCandidateScores, sameSemanticScore, scoreCandidate } from './score';

/** Select from an explicit candidate set, independent of its input order. */
export function chooseFromCandidates(
  observation: AiObservation,
  candidates: readonly GameAction[],
): GameAction {
  if (candidates.length === 0) {
    throw new Error(`No legal AI candidate for player ${observation.playerId} in phase ${observation.phase}`);
  }

  const scored = candidates.map((action) => ({ action, score: scoreCandidate(observation, action) }));
  scored.sort((left, right) =>
    compareCandidateScores(left.score, right.score)
      || left.score.stableKey.localeCompare(right.score.stableKey),
  );

  const bestScore = scored[0]!.score;
  const tiedBest = scored
    .filter(({ score }) => sameSemanticScore(score, bestScore))
    .sort((left, right) => left.score.stableKey.localeCompare(right.score.stableKey));
  const randomValue = observation.decisionRandom >>> 0;
  return tiedBest[randomValue % tiedBest.length]!.action;
}

/** Select deterministically from the lexicographically best legal candidate tier. */
export function chooseBasicAiAction(observation: AiObservation): GameAction {
  return chooseFromCandidates(observation, generateCandidates(observation));
}
