import { Card, PlayerId, Rank, Suit } from './card';
import { deriveSeed, RandomSource, XorShift32 } from '../random/prng';
import { chooseFirstPlayer } from '../rules/first-player';

/** Game version: one deck (54 cards) or two decks (108 cards). Same rules, AI and scoring either way. */
export type DeckCount = 1 | 2;

/** START_GAME without a deck count plays the two-deck game. */
export const DEFAULT_DECK_COUNT: DeckCount = 2;

const CARDS_PER_DECK = 54;

const ordinaryRanks = [
  Rank.THREE,
  Rank.FOUR,
  Rank.FIVE,
  Rank.SIX,
  Rank.SEVEN,
  Rank.EIGHT,
  Rank.NINE,
  Rank.TEN,
  Rank.JACK,
  Rank.QUEEN,
  Rank.KING,
  Rank.ACE,
  Rank.TWO,
] as const;

const ordinarySuits = [Suit.CLUB, Suit.DIAMOND, Suit.HEART, Suit.SPADE] as const;

function createCard(deckIndex: 0 | 1, suit: Suit, rank: Rank): Card {
  return {
    id: `${deckIndex}:${suit}:${rank}`,
    deckIndex,
    rank,
    suit,
  };
}

export function isDeckCount(value: unknown): value is DeckCount {
  return value === 1 || value === 2;
}

function assertDeckCount(deckCount: DeckCount): void {
  if (!isDeckCount(deckCount)) throw new RangeError(`deckCount must be 1 or 2; received ${String(deckCount)}`);
}

/** Physical cards in a game of this version: 54 or 108. */
export function deckSize(deckCount: DeckCount): number {
  assertDeckCount(deckCount);
  return deckCount * CARDS_PER_DECK;
}

/** Every physical card of the version, in a fixed order; one deck is exactly the first deck of two. */
export function createDeck(deckCount: DeckCount): readonly Card[] {
  assertDeckCount(deckCount);
  const cards: Card[] = [];

  for (const deckIndex of ([0, 1] as const).slice(0, deckCount)) {
    for (const rank of ordinaryRanks) {
      for (const suit of ordinarySuits) {
        cards.push(createCard(deckIndex, suit, rank));
      }
    }
    cards.push(createCard(deckIndex, Suit.JOKER, Rank.SMALL_JOKER));
    cards.push(createCard(deckIndex, Suit.JOKER, Rank.BIG_JOKER));
  }

  return cards;
}

export function createDoubleDeck(): readonly Card[] {
  return createDeck(2);
}

export function shuffle<T>(source: readonly T[], rng: RandomSource): T[] {
  const shuffled = [...source];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export interface Deal {
  readonly hands: readonly (readonly Card[])[];
  /** Seat that received the first card; with one deck it and the next seat clockwise get 14 cards. */
  readonly dealStartSeat: PlayerId;
  /** Best threes holder (see first-player.ts). */
  readonly firstPlayer: PlayerId;
  readonly dealStateAfterSetup: number;
}

/**
 * Shuffle with the seed's DEAL stream, then hand the cards out one at a time clockwise.
 * Two decks start at seat 0 (27 cards each, the same hands as before deck versions existed); one deck
 * starts at a seat drawn from the same stream, so that seat and the next get 14 cards, the others 13,
 * and each team holds one 14-card hand.
 */
export function dealFourPlayers(rootSeed: number, deckCount: DeckCount = DEFAULT_DECK_COUNT): Deal {
  assertDeckCount(deckCount);
  const rng = new XorShift32(deriveSeed(rootSeed, 'DEAL'));
  const deck = shuffle(createDeck(deckCount), rng);
  const dealStartSeat = (deckCount === 1 ? rng.nextInt(4) : 0) as PlayerId;
  const hands: Card[][] = [[], [], [], []];

  for (let index = 0; index < deck.length; index += 1) {
    hands[(dealStartSeat + index) % 4]!.push(deck[index]!);
  }

  const firstPlayer = chooseFirstPlayer(hands, rng);
  return {
    hands,
    dealStartSeat,
    firstPlayer,
    dealStateAfterSetup: rng.snapshot(),
  };
}
