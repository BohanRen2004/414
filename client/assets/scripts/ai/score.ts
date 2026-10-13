import { Card, Rank } from '../core/cards/card';
import { PlayPattern } from '../core/patterns/play-pattern';
import { recognize } from '../core/patterns/recognize';
import { GameAction } from '../core/state/game-action';
import { AiObservation } from './ai-observation';

export interface CandidateScore {
  readonly finishesNow: number;
  /** Phase policy gate (see policyTier); after finishesNow, a higher tier always wins. */
  readonly tier: number;
  /** Protected structures (3+ groups, joker bomb, 4A4) the action takes apart. */
  readonly structuresBroken: number;
  /** A takeover from the teammate that starts a go-out plan (see startsGoOut); it goes before the weakest. */
  readonly goOut: number;
  /** Beating power spent; responses and forced bomb leads use the weakest. */
  readonly strength: number;
  /** Free-lead rank bucket, so small cards go out first. */
  readonly leadRank: number;
  readonly cardsRemoved: number;
  readonly shapeGain: number;
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

function isBombClass(pattern: PlayPattern): boolean {
  return pattern.kind === 'N_OF_KIND_BOMB' || pattern.kind === 'JOKER_BOMB' || pattern.kind === 'FOUR_A_FOUR';
}

/** Total order of beating power: ordinary < N of a kind (count, rank) < joker bomb < 4A4 < heart 4A4. */
function patternStrength(pattern: PlayPattern): number {
  switch (pattern.kind) {
    case 'SINGLE':
    case 'PAIR':
      return pattern.rank;
    case 'STRAIGHT':
    case 'DOUBLE_STRAIGHT':
    case 'TRIPLE_STRAIGHT':
      return pattern.high;
    case 'N_OF_KIND_BOMB':
      return 20 + pattern.count * 16 + pattern.rank;
    case 'JOKER_BOMB':
      return 200;
    case 'FOUR_A_FOUR':
      return pattern.allHearts ? 202 : 201;
    default:
      return 0;
  }
}

function patternShapeGain(pattern: PlayPattern): number {
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

function rankCounts(cards: readonly Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return counts;
}

function holds(counts: ReadonlyMap<Rank, number>, rank: Rank, count: number): boolean {
  return (counts.get(rank) ?? 0) >= count;
}

function hasJokerBomb(counts: ReadonlyMap<Rank, number>): boolean {
  return holds(counts, Rank.SMALL_JOKER, 1) && holds(counts, Rank.BIG_JOKER, 1);
}

function hasFourAFour(counts: ReadonlyMap<Rank, number>): boolean {
  return holds(counts, Rank.FOUR, 2) && holds(counts, Rank.ACE, 1);
}

/** Count protected structures that shrink or vanish, unless the play is exactly that structure. */
function countBrokenStructures(hand: readonly Card[], played: readonly Card[], pattern: PlayPattern): number {
  const before = rankCounts(hand);
  const after = new Map(before);
  for (const card of played) after.set(card.rank, (after.get(card.rank) ?? 0) - 1);
  let broken = 0;
  for (const [rank, count] of before) {
    if (rank > Rank.TWO || count < 3) continue;
    const left = after.get(rank) ?? 0;
    if (left < count && !(left === 0 && played.length === count)) broken += 1;
  }
  if (hasJokerBomb(before) && !hasJokerBomb(after) && pattern.kind !== 'JOKER_BOMB') broken += 1;
  if (hasFourAFour(before) && !hasFourAFour(after) && pattern.kind !== 'FOUR_A_FOUR') broken += 1;
  return broken;
}

/** Public card counting: copies of each rank (indexed by `Rank`) neither in this hand nor played; others hold them. */
function unseenRankCounts(observation: AiObservation): number[] {
  const unseen: number[] = [];
  for (let rank = Rank.THREE; rank <= Rank.BIG_JOKER; rank += 1) {
    const copies = rank >= Rank.SMALL_JOKER ? observation.deckCount : 4 * observation.deckCount;
    unseen.push(copies - (observation.publicPlayedRankCounts[rank] ?? 0));
  }
  for (const card of observation.ownHand) unseen[card.rank] = (unseen[card.rank] ?? 0) - 1;
  return unseen;
}

/**
 * Could the unseen cards form a play of the same shape that beats this one? Bombs are left out: an ordinary
 * takeover cannot stop a bomb either, so they never decide which ordinary play to make.
 */
function unseenBeatsInKind(pattern: PlayPattern, unseen: readonly number[]): boolean {
  switch (pattern.kind) {
    case 'SINGLE':
    case 'PAIR': {
      const size = pattern.kind === 'SINGLE' ? 1 : 2;
      for (let rank = pattern.rank + 1; rank <= Rank.BIG_JOKER; rank += 1) {
        if ((unseen[rank] ?? 0) >= size) return true;
      }
      return false;
    }
    case 'STRAIGHT':
    case 'DOUBLE_STRAIGHT':
    case 'TRIPLE_STRAIGHT':
      for (let high = pattern.high + 1; high <= Rank.ACE; high += 1) {
        let complete = true;
        for (let rank = high - pattern.runLength + 1; rank <= high && complete; rank += 1) {
          complete = (unseen[rank] ?? 0) >= pattern.multiplicity;
        }
        if (complete) return true;
      }
      return false;
    default:
      return false;
  }
}

/**
 * Teammate holds: an opponent is down to 1..3 cards and the unseen cards could still beat the teammate's play.
 * When nothing unseen can (say, a single above every unseen card), a takeover protects nothing.
 */
function opponentThreat(observation: AiObservation, unseen: readonly number[]): boolean {
  const nearOut = observation.publicPlayers.some((player) =>
    player.teamId !== observation.teamId && player.remaining >= 1 && player.remaining <= 3,
  );
  const play = observation.currentPlay;
  return nearOut && (play === null || unseenBeatsInKind(play.pattern, unseen));
}

/** A hand as one play per rank, with a lone small and big joker kept together as the joker bomb. */
function rankGroups(cards: readonly Card[]): Card[][] {
  const byRank = new Map<Rank, Card[]>();
  for (const card of cards) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  const groups: Card[][] = [];
  const small = byRank.get(Rank.SMALL_JOKER);
  const big = byRank.get(Rank.BIG_JOKER);
  if (small?.length === 1 && big?.length === 1) {
    groups.push([...small, ...big]);
    byRank.delete(Rank.SMALL_JOKER);
    byRank.delete(Rank.BIG_JOKER);
  }
  return [...groups, ...byRank.values()];
}

/**
 * Go-out plan: no unseen cards beat the play in kind, and the rest of the hand is one play, or plays of which
 * at most one could be beaten in kind, so after winning the trick the hand can be led out to its last card.
 */
function startsGoOut(
  observation: AiObservation,
  played: readonly Card[],
  pattern: PlayPattern,
  unseen: readonly number[],
): boolean {
  if (unseenBeatsInKind(pattern, unseen)) return false;
  const ids = new Set(played.map((card) => card.id));
  const rest = observation.ownHand.filter((card) => !ids.has(card.id));
  if (rest.length === 0 || recognize(rest).kind !== 'INVALID') return true;
  let beatable = 0;
  for (const group of rankGroups(rest)) {
    const groupPattern = recognize(group);
    if (groupPattern.kind === 'INVALID') return false;
    if (unseenBeatsInKind(groupPattern, unseen)) beatable += 1;
  }
  return beatable <= 1;
}

/** During a gou-cha chain the holder is the last CHA/GOU player, not the owner of the single. */
function holderIsTeammate(observation: AiObservation): boolean {
  const holderId = observation.holderId;
  return holderId !== null
    && holderId !== observation.playerId
    && observation.publicPlayers[holderId]?.teamId === observation.teamId;
}

/**
 * Free lead: 1 keeps every structure, 0 otherwise.
 * Opponent holds: 3 safe beat or join, 2 bomb or break when nothing safe beats, 1 pass/decline,
 * 0 a gou-cha join that splits its own bomb.
 * Teammate holds: 2 safe takeover on a counted threat (see opponentThreat) or big shape gain, 1 pass/decline,
 * 0 otherwise.
 */
function policyTier(
  observation: AiObservation,
  action: GameAction,
  risky: boolean,
  shapeGain: number,
  unseen: readonly number[],
): number {
  if (action.kind === 'PASS' || action.kind === 'DECLINE_GOUCHA') return 1;
  if (observation.phase === 'FREE_LEAD') return risky ? 0 : 1;
  if (holderIsTeammate(observation)) {
    if (action.kind === 'ADD_GOUCHA' || risky) return 0;
    return shapeGain >= 3 || opponentThreat(observation, unseen) ? 2 : 0;
  }
  if (!risky) return 3;
  return action.kind === 'ADD_GOUCHA' ? 0 : 2;
}

/** Lowest rank that can be led alone without breaking a protected structure. */
function lowestSafeRank(hand: readonly Card[]): number {
  for (let rank = Rank.THREE; rank <= Rank.BIG_JOKER; rank += 1) {
    const card = hand.find((candidate) => candidate.rank === rank);
    if (card !== undefined && countBrokenStructures(hand, [card], recognize([card])) === 0) return rank;
  }
  return Rank.BIG_JOKER;
}

/** Lowest starting rank leads first; plays that spend an A, 2 or joker wait while any other safe lead exists. */
function leadRank(hand: readonly Card[], played: readonly Card[]): number {
  const low = Math.min(...played.map((card) => card.rank));
  const spendsTopCard = played.some((card) => card.rank >= Rank.ACE);
  return spendsTopCard && lowestSafeRank(hand) < Rank.ACE ? Rank.BIG_JOKER + 1 + low : low;
}

function semanticValues(score: CandidateScore): readonly number[] {
  return [
    score.finishesNow,
    score.tier,
    -score.structuresBroken,
    score.goOut,
    -score.strength,
    -score.leadRank,
    score.cardsRemoved,
    score.shapeGain,
    -score.highRankCost,
  ];
}

/** Compare semantic score only; stable physical IDs order ties before the public-view tie-break. */
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
  const playsCards = action.kind === 'PLAY_CARDS' || action.kind === 'ADD_GOUCHA';
  const finishing = playsCards && observation.ownHand.length > 0 && cards.length === observation.ownHand.length;
  const structuresBroken = playsCards ? countBrokenStructures(observation.ownHand, cards, pattern) : 0;
  const risky = (action.kind === 'PLAY_CARDS' && isBombClass(pattern)) || structuresBroken > 0;
  const shapeGain = patternShapeGain(pattern);
  const unseen = unseenRankCounts(observation);
  const tier = policyTier(observation, action, risky, shapeGain, unseen);
  const safeLead = observation.phase === 'FREE_LEAD' && tier > 0;
  const goOut = tier === 2 && action.kind === 'PLAY_CARDS' && !finishing && holderIsTeammate(observation)
    && startsGoOut(observation, cards, pattern, unseen);

  return {
    finishesNow: finishing ? 1 : 0,
    tier,
    structuresBroken,
    goOut: goOut ? 1 : 0,
    strength: safeLead ? 0 : patternStrength(pattern),
    leadRank: safeLead ? leadRank(observation.ownHand, cards) : 0,
    cardsRemoved: cards.length,
    shapeGain,
    highRankCost: cards.reduce((total, card) => total + rankCost(card), 0),
    stableKey: stableActionKey(action),
  };
}

export function sameSemanticScore(left: CandidateScore, right: CandidateScore): boolean {
  return compareCandidateScores(left, right) === 0;
}
