import { describe, expect, it } from 'vitest';
import { Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck, dealFourPlayers, shuffle } from '../../client/assets/scripts/core/cards/deck';
import { XorShift32 } from '../../client/assets/scripts/core/random/prng';

const ordinaryRanks = [Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE, Rank.TWO] as const;
const ordinarySuits = [Suit.CLUB, Suit.DIAMOND, Suit.HEART, Suit.SPADE] as const;

describe('double deck', () => {
  it('contains 108 unique physical cards', () => {
    const deck = createDoubleDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((card) => card.id)).size).toBe(108);
    for (const deckIndex of [0, 1] as const) {
      const physicalDeck = deck.filter((card) => card.deckIndex === deckIndex);
      expect(physicalDeck).toHaveLength(54);
      expect(physicalDeck.filter((card) => card.rank === Rank.SMALL_JOKER)).toHaveLength(1);
      expect(physicalDeck.filter((card) => card.rank === Rank.BIG_JOKER)).toHaveLength(1);
      for (const rank of ordinaryRanks) {
        for (const suit of ordinarySuits) {
          expect(physicalDeck.filter((card) => card.rank === rank && card.suit === suit)).toHaveLength(1);
        }
      }
    }
  });

  it('deals 27 cards to each player deterministically', () => {
    const a = dealFourPlayers(414);
    const b = dealFourPlayers(414);
    expect(a).toEqual(b);
    expect(a).not.toEqual(dealFourPlayers(415));
    expect(a.hands.map((hand) => hand.length)).toEqual([27, 27, 27, 27]);
    expect(new Set(a.hands.flat().map((card) => card.id))).toEqual(new Set(createDoubleDeck().map((card) => card.id)));
    expect(a.firstPlayer).toBeGreaterThanOrEqual(0);
    expect(a.firstPlayer).toBeLessThan(4);
  });

  it('locks the PRNG algorithm to a known vector', () => {
    const rng = new XorShift32(1);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual([
      270369, 67634689, 2647435461,
    ]);
  });

  it('validates integer bounds and shuffles a copy', () => {
    const rng = new XorShift32(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5)).toThrow(RangeError);
    expect(() => rng.nextInt(0x1_0000_0001)).toThrow(RangeError);
    const source = [1, 2, 3, 4];
    const result = shuffle(source, new XorShift32(1));
    expect(source).toEqual([1, 2, 3, 4]);
    expect(result).toHaveLength(source.length);
    expect(new Set(result)).toEqual(new Set(source));
  });
});
