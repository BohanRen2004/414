import { describe, expect, it } from 'vitest';
import { Card, PlayerId, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { createDeck, createDoubleDeck, DeckCount, deckSize, dealFourPlayers, shuffle } from '../../client/assets/scripts/core/cards/deck';
import { deriveSeed, XorShift32 } from '../../client/assets/scripts/core/random/prng';
import { firstPlayerCandidates } from '../../client/assets/scripts/core/rules/first-player';

const ordinaryRanks = [Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE, Rank.TWO] as const;
const ordinarySuits = [Suit.CLUB, Suit.DIAMOND, Suit.HEART, Suit.SPADE] as const;

function ids(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id);
}

/** FNV-1a over every hand's card IDs in deal order. */
function handsFingerprint(hands: readonly (readonly Card[])[]): number {
  const text = hands.map((hand) => ids(hand).join(',')).join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

/** Reference statement of the deal: shuffle with the DEAL stream, then hand out one card at a time clockwise. */
function referenceHands(seed: number, deckCount: DeckCount): { hands: Card[][]; startSeat: PlayerId } {
  const rng = new XorShift32(deriveSeed(seed, 'DEAL'));
  const deck = shuffle(createDeck(deckCount), rng);
  const startSeat = (deckCount === 1 ? rng.nextInt(4) : 0) as PlayerId;
  const hands: Card[][] = [[], [], [], []];
  deck.forEach((card, index) => hands[(startSeat + index) % 4]!.push(card));
  return { hands, startSeat };
}

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
    // The first player is no longer an independent random seat: it is the seat with the best threes.
    expect(firstPlayerCandidates(a.hands)).toContain(a.firstPlayer);
  });

  it('defaults to two decks and keeps the existing card distribution of every seed', () => {
    expect(createDeck(2)).toEqual(createDoubleDeck());
    expect(deckSize(2)).toBe(108);
    // Fingerprints of the hands dealt before deck versions existed (commit 56e1533): only the first player may change.
    const before: Readonly<Record<number, number>> = {
      414: 0x907d9b23,
      0: 0x7566fc1b,
      1: 0xa1321ac5,
      2026: 0xc5ae6b57,
      0xffff_ffff: 0xb8528f8f,
    };
    for (const [seedText, fingerprint] of Object.entries(before)) {
      const seed = Number(seedText);
      const deal = dealFourPlayers(seed);
      expect(handsFingerprint(deal.hands), `seed ${seed}`).toBe(fingerprint);
      expect(dealFourPlayers(seed, 2)).toEqual(deal);
      expect(deal.dealStartSeat).toBe(0);
    }
    for (let seed = 0; seed < 32; seed += 1) {
      expect(dealFourPlayers(seed, 2).hands).toEqual(referenceHands(seed, 2).hands);
    }
  });

  it('rejects a deck count other than one or two', () => {
    for (const deckCount of [0, 3, 1.5, Number.NaN]) {
      expect(() => createDeck(deckCount as DeckCount)).toThrow(RangeError);
      expect(() => dealFourPlayers(414, deckCount as DeckCount)).toThrow(RangeError);
      expect(() => deckSize(deckCount as DeckCount)).toThrow(RangeError);
    }
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

describe('single deck', () => {
  it('contains the 54 unique cards of one physical deck', () => {
    const deck = createDeck(1);
    expect(deck).toHaveLength(54);
    expect(deckSize(1)).toBe(54);
    expect(new Set(ids(deck)).size).toBe(54);
    expect(deck.every((card) => card.deckIndex === 0)).toBe(true);
    expect(deck.filter((card) => card.rank === Rank.SMALL_JOKER)).toHaveLength(1);
    expect(deck.filter((card) => card.rank === Rank.BIG_JOKER)).toHaveLength(1);
    for (const rank of ordinaryRanks) {
      for (const suit of ordinarySuits) {
        expect(deck.filter((card) => card.rank === rank && card.suit === suit)).toHaveLength(1);
      }
    }
    // Same physical identities as the first deck of the two-deck game.
    expect(deck).toEqual(createDoubleDeck().filter((card) => card.deckIndex === 0));
  });

  it('deals 14 cards to the seeded start seat and the next seat clockwise, 13 to the other two', () => {
    const fullDeck = new Set(ids(createDeck(1)));
    for (let seed = 0; seed < 64; seed += 1) {
      const deal = dealFourPlayers(seed, 1);
      const start = deal.dealStartSeat;
      expect([0, 1, 2, 3]).toContain(start);
      expect(deal.hands.map((hand) => hand.length), `seed ${seed}`)
        .toEqual([0, 1, 2, 3].map((seat) => ((seat - start + 4) % 4 < 2 ? 14 : 13)));
      // The two 14-card seats are adjacent, so each team (0/2 and 1/3) has exactly one of them.
      expect(deal.hands[0]!.length + deal.hands[2]!.length).toBe(27);
      expect(deal.hands[1]!.length + deal.hands[3]!.length).toBe(27);
      const dealt = deal.hands.flatMap(ids);
      expect(dealt).toHaveLength(54);
      expect(new Set(dealt)).toEqual(fullDeck);
    }
  });

  it('hands the shuffled deck out one card at a time clockwise from the start seat', () => {
    for (let seed = 0; seed < 32; seed += 1) {
      const reference = referenceHands(seed, 1);
      const deal = dealFourPlayers(seed, 1);
      expect(deal.dealStartSeat).toBe(reference.startSeat);
      expect(deal.hands).toEqual(reference.hands);
    }
  });

  it('is deterministic per seed while different seeds vary the start seat and the cards', () => {
    expect(dealFourPlayers(414, 1)).toEqual(dealFourPlayers(414, 1));
    expect(dealFourPlayers(414, 1).hands).not.toEqual(dealFourPlayers(415, 1).hands);
    const startSeats = new Set(Array.from({ length: 40 }, (_unused, seed) => dealFourPlayers(seed, 1).dealStartSeat));
    expect(startSeats).toEqual(new Set([0, 1, 2, 3]));
  });
});
