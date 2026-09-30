import { Card, Rank } from '../core/cards/card';
import { recognize } from '../core/patterns/recognize';
import { GameAction } from '../core/state/game-action';
import { AiObservation } from './ai-observation';

export interface CandidateScore {
  readonly finishesNow: number;
  readonly blocksThreat: number;
  /** Effective hand reduction after preserving bombs and a teammate's lead. */
  readonly cardsRemoved: number;
  readonly shapeGain: number;
  readonly teammatePenalty: number;
  readonly specialCost: number;
  readonly highRankCost: number;
  readonly stableKey: string;
}

function actionCards(observation: AiObservation, action: GameAction): Card[] {
  if (!('cardIds' in action)) return [];
  return action.cardIds.flatMap((id) => {
    const card = observation.ownHand.find((candidate) => candidate.id === id);
    return card === undefined ? [] : [card];
  });
}

function stableActionKey(action: GameAction): string {
  const ids = 'cardIds' in action ? [...action.cardIds].sort() : [];
  return `${action.kind}:${ids.join('|')}`;
}

function patternCost(pattern: ReturnType<typeof recognize>): number {
  if (pattern.kind === 'JOKER_BOMB') return 8;
  if (pattern.kind === 'FOUR_A_FOUR') return pattern.allHearts ? 7 : 6;
  if (pattern.kind === 'N_OF_KIND_BOMB') {
    if (pattern.count >= 5) return pattern.count + 2;
    return pattern.count;
  }
  return 0;
}

function patternShapeGain(pattern: ReturnType<typeof recognize>): number {
  if (
    pattern.kind === 'STRAIGHT'
    || pattern.kind === 'DOUBLE_STRAIGHT'
    || pattern.kind === 'TRIPLE_STRAIGHT'
  ) return Math.max(0, pattern.runLength - 3) * pattern.multiplicity;
  return 0;
}

function rankCost(card: Card): number {
  if (card.rank === Rank.SMALL_JOKER) return 13;
  if (card.rank === Rank.BIG_JOKER) return 14;
  return card.rank - Rank.THREE;
}

function isTakeover(action: GameAction, observation: AiObservation): boolean {
  return action.kind === 'PLAY_CARDS' && observation.phase === 'RESPONDING'
    || action.kind === 'ADD_GOUCHA' && observation.phase === 'GOUCHA_QUERY';
}

function threatScore(observation: AiObservation, action: GameAction): number {
  if (!isTakeover(action, observation)) return 0;
  const opponents = observation.publicPlayers.filter((player) =>
    player.teamId !== observation.teamId && player.playerId !== observation.playerId,
  );
  const threat = opponents
    .map((player) => player.remaining)
    .filter((remaining) => remaining >= 1 && remaining <= 3)
    .reduce((smallest, remaining) => Math.min(smallest, remaining), Number.POSITIVE_INFINITY);
  return Number.isFinite(threat) ? 4 - threat : 0;
}

function holderIsTeammate(observation: AiObservation): boolean {
  const holderId = observation.currentPlay?.playerId;
  return holderId !== undefined
    && holderId !== observation.playerId
    && observation.publicPlayers[holderId]?.teamId === observation.teamId;
}

function semanticValues(score: CandidateScore): readonly number[] {
  return [
    score.finishesNow,
    score.blocksThreat,
    -score.teammatePenalty,
    score.cardsRemoved,
    score.shapeGain,
    -score.specialCost,
    -score.highRankCost,
  ];
}

/** Compare semantic score only; stable physical IDs order ties before seeded selection. */
export function compareCandidateScores(left: CandidateScore, right: CandidateScore): number {
  const a = semanticValues(left);
  const b = semanticValues(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index]! - a[index]!;
  }
  return 0;
}

export function scoreCandidate(observation: AiObservation, action: GameAction): CandidateScore {
  const cards = actionCards(observation, action);
  const pattern = recognize(cards);
  const finishing = (action.kind === 'PLAY_CARDS' || action.kind === 'ADD_GOUCHA')
    && observation.ownHand.length > 0
    && cards.length === observation.ownHand.length;
  const blocksThreat = threatScore(observation, action);
  const rawShapeGain = patternShapeGain(pattern)
    + (action.kind === 'ADD_GOUCHA' ? 1 : 0);
  const takesTeammateLead = isTakeover(action, observation) && holderIsTeammate(observation);
  const significantImprovement = rawShapeGain >= 3;
  const teammatePenalty = takesTeammateLead && !finishing && blocksThreat === 0 && !significantImprovement ? 1 : 0;
  const specialCost = patternCost(pattern);
  const actualCardsRemoved = action.kind === 'PLAY_CARDS' || action.kind === 'ADD_GOUCHA' ? cards.length : 0;
  const cardsRemoved = teammatePenalty > 0
    ? 0
    : Math.max(0, actualCardsRemoved - (observation.phase === 'FREE_LEAD' ? specialCost : 0));
  const shapeGain = teammatePenalty > 0 ? 0 : rawShapeGain;

  return {
    finishesNow: finishing ? 1 : 0,
    blocksThreat,
    cardsRemoved,
    shapeGain,
    teammatePenalty,
    specialCost,
    highRankCost: cards.reduce((total, card) => total + rankCost(card), 0),
    stableKey: stableActionKey(action),
  };
}

export function sameSemanticScore(left: CandidateScore, right: CandidateScore): boolean {
  return compareCandidateScores(left, right) === 0;
}
