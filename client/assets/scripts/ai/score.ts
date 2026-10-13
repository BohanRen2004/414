import { Card, Rank } from '../core/cards/card';
import { DeckCount } from '../core/cards/deck';
import { beats } from '../core/patterns/compare';
import { PlayPattern } from '../core/patterns/play-pattern';
import { recognize } from '../core/patterns/recognize';
import { GameAction } from '../core/state/game-action';
import { AiObservation } from './ai-observation';

export interface CandidateScore {
  readonly finishesNow: number;
  /** R6 go-out plan (see startsGoOut): right after an outright finish, before the phase policy. */
  readonly goOut: number;
  /** Phase policy gate (see policyTier); after finishesNow and goOut, a higher tier always wins. */
  readonly tier: number;
  /** Protected structures (3+ groups, joker bomb, 4A4) the action takes apart. */
  readonly structuresBroken: number;
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
 * Could a hand of at most `cards` unseen cards form a play of the same shape that beats this one? Bombs are
 * left out here: R3's threat test ignores them (an ordinary takeover cannot stop a bomb either), and R6 adds
 * them through possibleBombs.
 */
function unseenBeatsInKind(
  pattern: PlayPattern,
  unseen: readonly number[],
  cards = Number.POSITIVE_INFINITY,
): boolean {
  switch (pattern.kind) {
    case 'SINGLE':
    case 'PAIR': {
      const size = pattern.kind === 'SINGLE' ? 1 : 2;
      if (cards < size) return false;
      for (let rank = pattern.rank + 1; rank <= Rank.BIG_JOKER; rank += 1) {
        if ((unseen[rank] ?? 0) >= size) return true;
      }
      return false;
    }
    case 'STRAIGHT':
    case 'DOUBLE_STRAIGHT':
    case 'TRIPLE_STRAIGHT':
      if (cards < pattern.runLength * pattern.multiplicity) return false;
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

/**
 * The strongest bomb of each kind that a hand of `cards` unseen cards could hold. A heart 4A4 is assumed
 * possible whenever two decks leave a 4A4 unseen, since the counts do not track suits.
 */
function possibleBombs(unseen: readonly number[], cards: number, deckCount: DeckCount): PlayPattern[] {
  const bombs: PlayPattern[] = [];
  for (let rank = Rank.THREE; rank <= Rank.TWO; rank += 1) {
    const count = Math.min(unseen[rank] ?? 0, cards);
    if (count >= 3) bombs.push({ kind: 'N_OF_KIND_BOMB', rank, count });
  }
  if (cards >= 2 && (unseen[Rank.SMALL_JOKER] ?? 0) >= 1 && (unseen[Rank.BIG_JOKER] ?? 0) >= 1) {
    bombs.push({ kind: 'JOKER_BOMB' });
  }
  if (cards >= 3 && (unseen[Rank.FOUR] ?? 0) >= 2 && (unseen[Rank.ACE] ?? 0) >= 1) {
    bombs.push({ kind: 'FOUR_A_FOUR', allHearts: deckCount === 2 });
  }
  return bombs;
}

type BeatTest = (pattern: PlayPattern) => boolean;

/**
 * R6's "could be beaten", from public information only: the unseen cards may sit in any other hand, so a play
 * is beatable when some opponent still holding cards has room, by its public card count, for an unseen play of
 * the same shape that beats it or for an unseen bomb that does. A CHA is an action, not a beat (see 10.1).
 */
function opponentCanBeat(observation: AiObservation, unseen: readonly number[]): BeatTest {
  let cards = 0;
  for (const player of observation.publicPlayers) {
    if (player.teamId !== observation.teamId) cards = Math.max(cards, player.remaining);
  }
  const bombs = possibleBombs(unseen, cards, observation.deckCount);
  return (pattern) => cards > 0
    && (unseenBeatsInKind(pattern, unseen, cards) || bombs.some((bomb) => beats(bomb, pattern)));
}

function groupPattern(rank: Rank, count: number): PlayPattern | null {
  if (count === 1) return { kind: 'SINGLE', rank };
  if (count === 2) return { kind: 'PAIR', rank };
  return rank <= Rank.TWO ? { kind: 'N_OF_KIND_BOMB', rank, count } : null;
}

function straightPattern(low: Rank, high: Rank, multiplicity: 1 | 2 | 3): PlayPattern {
  const kind = multiplicity === 1 ? 'STRAIGHT' : multiplicity === 2 ? 'DOUBLE_STRAIGHT' : 'TRIPLE_STRAIGHT';
  return { kind, multiplicity, runLength: high - low + 1, low, high };
}

/**
 * Can the cards counted by rank be led out as plays nobody can beat plus at most `open` plays that could be
 * beaten (led last)? Every split is tried through the lowest card left: with more of its rank or alone, as
 * the low end of a straight, as a 4 of a 4A4, or as the small joker of the joker bomb.
 */
function leadsOut(counts: number[], open: number, canBeat: BeatTest, memo: Map<string, boolean>): boolean {
  let low: Rank = Rank.THREE;
  while (low <= Rank.BIG_JOKER && counts[low] === 0) low += 1;
  if (low > Rank.BIG_JOKER) return true;
  const key = `${counts.join(',')}/${open}`;
  const known = memo.get(key);
  if (known !== undefined) return known;

  const plays: { readonly pattern: PlayPattern; readonly ranks: readonly Rank[] }[] = [];
  const have = counts[low]!;
  for (let count = have; count >= 1; count -= 1) {
    const pattern = groupPattern(low, count);
    if (pattern !== null) plays.push({ pattern, ranks: Array.from({ length: count }, () => low) });
  }
  for (const multiplicity of [1, 2, 3] as const) {
    if (have < multiplicity || low > Rank.QUEEN) break;
    const ranks: Rank[] = [];
    for (let high = low; high <= Rank.ACE && counts[high]! >= multiplicity; high += 1) {
      for (let copy = 0; copy < multiplicity; copy += 1) ranks.push(high);
      if (high - low >= 2) plays.push({ pattern: straightPattern(low, high, multiplicity), ranks: [...ranks] });
    }
  }
  if (low === Rank.FOUR && have >= 2 && counts[Rank.ACE]! >= 1) {
    plays.push({ pattern: { kind: 'FOUR_A_FOUR', allHearts: false }, ranks: [Rank.FOUR, Rank.FOUR, Rank.ACE] });
  }
  if (low === Rank.SMALL_JOKER && counts[Rank.BIG_JOKER]! >= 1) {
    plays.push({ pattern: { kind: 'JOKER_BOMB' }, ranks: [Rank.SMALL_JOKER, Rank.BIG_JOKER] });
  }

  let result = false;
  for (const { pattern, ranks } of plays) {
    const left = open - Number(canBeat(pattern));
    if (left < 0) continue;
    for (const rank of ranks) counts[rank]! -= 1;
    result = leadsOut(counts, left, canBeat, memo);
    for (const rank of ranks) counts[rank]! += 1;
    if (result) break;
  }
  memo.set(key, result);
  return result;
}

/** During a gou-cha chain the holder is the last CHA/GOU player, not the owner of the single. */
function holderIsTeammate(observation: AiObservation): boolean {
  const holderId = observation.holderId;
  return holderId !== null
    && holderId !== observation.playerId
    && observation.publicPlayers[holderId]?.teamId === observation.teamId;
}

/**
 * R6 收尾抢权 (go-out plan): a play no opponent can beat (see opponentCanBeat), after which the rest of the hand
 * can be led out with at most one play that could still be beaten, kept for last. Over a teammate it must keep
 * R3's bomb rule (no bomb, no broken structure) and the teammate must still hold two or more cards.
 */
function startsGoOut(
  observation: AiObservation,
  action: GameAction,
  played: readonly Card[],
  pattern: PlayPattern,
  risky: boolean,
  unseen: readonly number[],
): boolean {
  if (action.kind !== 'PLAY_CARDS') return false;
  if (holderIsTeammate(observation) && (risky || observation.publicPlayers[observation.holderId!]!.remaining < 2)) {
    return false;
  }
  const canBeat = opponentCanBeat(observation, unseen);
  if (canBeat(pattern)) return false;
  const counts = new Array<number>(Rank.BIG_JOKER + 1).fill(0);
  for (const card of observation.ownHand) counts[card.rank] = (counts[card.rank] ?? 0) + 1;
  for (const card of played) counts[card.rank] = (counts[card.rank] ?? 0) - 1;
  return leadsOut(counts, 1, canBeat, new Map());
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
    score.goOut,
    score.tier,
    -score.structuresBroken,
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
  const goOut = !finishing && startsGoOut(observation, action, cards, pattern, risky, unseen);

  return {
    finishesNow: finishing ? 1 : 0,
    goOut: goOut ? 1 : 0,
    tier,
    structuresBroken,
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
