import { Card, Rank, Suit } from '../cards/card';
import { PlayPattern } from './play-pattern';

function invalid(reason: Extract<PlayPattern, { kind: 'INVALID' }>['reason']): PlayPattern {
  return { kind: 'INVALID', reason };
}

function isOrdinaryRank(rank: Rank): boolean {
  return rank >= Rank.THREE && rank <= Rank.TWO;
}

export function recognize(cards: readonly Card[]): PlayPattern {
  if (cards.length === 0) return invalid('EMPTY');
  if (new Set(cards.map((card) => card.id)).size !== cards.length) return invalid('DUPLICATE_CARD_ID');

  if (cards.length === 1) return { kind: 'SINGLE', rank: cards[0]!.rank };

  if (cards.length === 2) {
    const [first, second] = cards as readonly [Card, Card];
    const isJokerBomb =
      (first.rank === Rank.SMALL_JOKER && second.rank === Rank.BIG_JOKER) ||
      (first.rank === Rank.BIG_JOKER && second.rank === Rank.SMALL_JOKER);
    if (isJokerBomb) return { kind: 'JOKER_BOMB' };
    if (first.rank === second.rank) return { kind: 'PAIR', rank: first.rank };
    return invalid('MIXED_RANKS');
  }

  if (cards.length === 3) {
    const fourCount = cards.filter((card) => card.rank === Rank.FOUR).length;
    const aceCount = cards.filter((card) => card.rank === Rank.ACE).length;
    if (fourCount === 2 && aceCount === 1) {
      return { kind: 'FOUR_A_FOUR', allHearts: cards.every((card) => card.suit === Suit.HEART) };
    }
  }

  const firstRank = cards[0]!.rank;
  if (
    cards.length <= 8 &&
    isOrdinaryRank(firstRank) &&
    cards.every((card) => card.rank === firstRank)
  ) {
    return { kind: 'N_OF_KIND_BOMB', rank: firstRank, count: cards.length };
  }

  if (cards.some((card) => card.rank === Rank.SMALL_JOKER || card.rank === Rank.BIG_JOKER)) {
    return invalid('UNSUPPORTED_COMBINATION');
  }

  if (cards.some((card) => card.rank === Rank.TWO)) return invalid('SEQUENCE_FORBIDDEN_RANK');

  const counts = new Map<Rank, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);

  const multiplicities = [...counts.values()];
  const multiplicity = multiplicities[0]!;
  if (multiplicity > 3 || multiplicities.some((count) => count !== multiplicity)) {
    return invalid('SEQUENCE_MULTIPLICITY');
  }

  const sequenceRanks = [...counts.keys()].sort((left, right) => left - right);
  if (sequenceRanks.length < 3) return invalid('SEQUENCE_TOO_SHORT');

  for (let index = 1; index < sequenceRanks.length; index += 1) {
    if (sequenceRanks[index] !== sequenceRanks[index - 1]! + 1) return invalid('SEQUENCE_GAP');
  }

  const kinds = ['STRAIGHT', 'DOUBLE_STRAIGHT', 'TRIPLE_STRAIGHT'] as const;
  return {
    kind: kinds[multiplicity - 1]!,
    multiplicity: multiplicity as 1 | 2 | 3,
    runLength: sequenceRanks.length,
    low: sequenceRanks[0]!,
    high: sequenceRanks[sequenceRanks.length - 1]!,
  };
}
