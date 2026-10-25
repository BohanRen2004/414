import { describe, expect, it } from 'vitest';
import { Card, PlayerId, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { XorShift32 } from '../../client/assets/scripts/core/random/prng';
import { chooseFirstPlayer, firstPlayerCandidates } from '../../client/assets/scripts/core/rules/first-player';
import { c } from '../helpers/cards';

const { HEART: H, SPADE: S, CLUB: C, DIAMOND: D } = Suit;

/**
 * Two-deck hands holding exactly the listed threes, plus one unrelated card each (hearts of other ranks
 * included, which must not count). Each suit has two physical threes, taken in order.
 */
function handsWithThrees(...seats: readonly (readonly Suit[])[]): Card[][] {
  const copiesUsed = new Map<Suit, number>();
  return seats.map((suits, seat) => [
    ...suits.map((suit): Card => {
      const deckIndex = copiesUsed.get(suit) ?? 0;
      if (deckIndex > 1) throw new Error(`fixture uses more than two threes of suit ${suit}`);
      copiesUsed.set(suit, deckIndex + 1);
      return { id: `${deckIndex}:${suit}:${Rank.THREE}`, rank: Rank.THREE, suit, deckIndex: deckIndex as 0 | 1 };
    }),
    c(`filler-${seat}`, seat % 2 === 0 ? Rank.FOUR : Rank.NINE, Suit.HEART),
  ]);
}

function heartThreeHolder(hands: readonly (readonly Card[])[]): PlayerId {
  const holder = hands.findIndex((hand) => hand.some((card) => card.rank === Rank.THREE && card.suit === Suit.HEART));
  if (holder < 0) throw new Error('nobody holds the heart three');
  return holder as PlayerId;
}

/** Decide the first player; also report whether the tie-break consumed the deal PRNG. */
function decide(hands: readonly (readonly Card[])[], seed = 414): { readonly firstPlayer: PlayerId; readonly drewRandom: boolean } {
  const rng = new XorShift32(seed);
  const before = rng.snapshot();
  const firstPlayer = chooseFirstPlayer(hands, rng);
  return { firstPlayer, drewRandom: rng.snapshot() !== before };
}

describe('first player by threes', () => {
  it('lets a seat holding both heart threes lead, ahead of any number of other threes', () => {
    const hands = handsWithThrees([S], [S, C, C, D, D], [H, H], []);
    expect(firstPlayerCandidates(hands)).toEqual([2]);
    expect(decide(hands)).toEqual({ firstPlayer: 2, drewRandom: false });
  });

  it('breaks a one-heart-three-each tie by spade threes', () => {
    // Seat 0 holds more threes in total but no heart three, so it never leads.
    const hands = handsWithThrees([S, C, C], [H, D, D], [], [H, S]);
    expect(firstPlayerCandidates(hands)).toEqual([3]);
    expect(decide(hands)).toEqual({ firstPlayer: 3, drewRandom: false });
  });

  it('breaks a heart and spade tie by club threes before diamond threes', () => {
    const hands = handsWithThrees([H, S, D, D], [H, S, C], [C], []);
    expect(firstPlayerCandidates(hands)).toEqual([1]);
    expect(decide(hands)).toEqual({ firstPlayer: 1, drewRandom: false });
  });

  it('breaks a heart, spade and club tie by diamond threes', () => {
    const hands = handsWithThrees([H, S, C], [D], [H, S, C, D], []);
    expect(firstPlayerCandidates(hands)).toEqual([2]);
    expect(decide(hands)).toEqual({ firstPlayer: 2, drewRandom: false });
  });

  it('picks among fully tied seats with the seeded deal PRNG, deterministically per seed', () => {
    const hands = handsWithThrees([H, S, C, D], [], [], [H, S, C, D]);
    expect(firstPlayerCandidates(hands)).toEqual([0, 3]);
    const chosen = new Set<PlayerId>();
    for (let seed = 1; seed <= 32; seed += 1) {
      const decision = decide(hands, seed);
      expect(decision.drewRandom).toBe(true);
      expect([0, 3]).toContain(decision.firstPlayer);
      expect(decide(hands, seed)).toEqual(decision);
      chosen.add(decision.firstPlayer);
    }
    expect(chosen).toEqual(new Set([0, 3]));
  });

  it('lets the heart-three holder lead every one-deck game', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const deal = dealFourPlayers(seed, 1);
      const holder = heartThreeHolder(deal.hands);
      expect(firstPlayerCandidates(deal.hands), `seed ${seed}`).toEqual([holder]);
      expect(deal.firstPlayer, `seed ${seed}`).toBe(holder);
    }
  });

  it('applies the rule to every two-deck deal and stays deterministic per seed', () => {
    let doubleHeartLeads = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      const deal = dealFourPlayers(seed);
      const candidates = firstPlayerCandidates(deal.hands);
      expect(candidates, `seed ${seed}`).toContain(deal.firstPlayer);
      const doubleHeart = deal.hands.findIndex((hand) =>
        hand.filter((card) => card.rank === Rank.THREE && card.suit === Suit.HEART).length === 2);
      if (doubleHeart >= 0) {
        doubleHeartLeads += 1;
        expect(deal.firstPlayer, `seed ${seed}`).toBe(doubleHeart);
      }
      expect(dealFourPlayers(seed).firstPlayer).toBe(deal.firstPlayer);
    }
    expect(doubleHeartLeads).toBeGreaterThan(0);
  });
});
