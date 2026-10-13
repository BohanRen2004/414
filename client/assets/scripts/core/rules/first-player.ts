import { Card, PlayerId, Rank, Suit } from '../cards/card';
import { RandomSource } from '../random/prng';

/** Suits of the threes that decide the first player, compared in this order. */
const THREE_SUIT_ORDER = [Suit.HEART, Suit.SPADE, Suit.CLUB, Suit.DIAMOND] as const;

/** How many ♥3, ♠3, ♣3 and ♦3 a hand holds, in that order. */
function threesKey(hand: readonly Card[]): number[] {
  return THREE_SUIT_ORDER.map((suit) =>
    hand.reduce((count, card) => count + Number(card.rank === Rank.THREE && card.suit === suit), 0));
}

/** Lexicographic comparison where more threes of an earlier suit is better. */
function compareKeys(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

/**
 * Seats tied for the best (♥3, ♠3, ♣3, ♦3) count tuple, compared lexicographically, in seat order.
 * With one deck this is always just the ♥3 holder; with two decks a seat holding both ♥3 always wins.
 */
export function firstPlayerCandidates(hands: readonly (readonly Card[])[]): PlayerId[] {
  if (hands.length !== 4) throw new RangeError(`expected four hands; received ${hands.length}`);
  const keys = hands.map(threesKey);
  const best = keys.reduce((top, key) => (compareKeys(key, top) > 0 ? key : top));
  return keys.flatMap((key, seat) => (compareKeys(key, best) === 0 ? [seat as PlayerId] : []));
}

/**
 * The seat that leads the first trick: the best threes holder. Only a full tie draws from the
 * deal PRNG, so the choice is deterministic per seed.
 */
export function chooseFirstPlayer(hands: readonly (readonly Card[])[], rng: RandomSource): PlayerId {
  const candidates = firstPlayerCandidates(hands);
  return candidates.length === 1 ? candidates[0]! : candidates[rng.nextInt(candidates.length)]!;
}
