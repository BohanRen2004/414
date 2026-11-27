import { Card, PlayerId, Rank, Suit } from './card';
import { deriveSeed, RandomSource, XorShift32 } from '../random/prng';
import { chooseFirstPlayer } from '../rules/first-player';

/** Game version: one deck (54 cards) or two decks (108 cards). Same rules, AI and scoring either way. */
export type DeckCount = 1 | 2;

/** Players at the table. Four play two teams; two or three play alone, with one deck only. */
export type PlayerCount = 2 | 3 | 4;

export function isPlayerCount(value: unknown): value is PlayerCount {
  return value === 2 || value === 3 || value === 4;
}

/** Cards each player gets with fewer than four players; the rest of the deck is set aside unseen. */
export const SMALL_TABLE_HAND: Readonly<Record<2 | 3, number>> = { 2: 22, 3: 18 };

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
  /** Four hands, one per seat; seats past the player count stay empty. */
  readonly hands: readonly (readonly Card[])[];
  /** Cards dealt to nobody (two players set 10 aside); nobody sees them. */
  readonly buried: readonly Card[];
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
    buried: [],
    dealStartSeat,
    firstPlayer,
    dealStateAfterSetup: rng.snapshot(),
  };
}

/**
 * Two or three players, one deck: shuffle with the seed's DEAL stream and deal one card at a time from seat 0,
 * 18 each for three players, 22 each for two with the last 10 set aside. Four players use dealFourPlayers.
 */
export function dealPlayers(rootSeed: number, deckCount: DeckCount, playerCount: PlayerCount): Deal {
  if (playerCount === 4) return dealFourPlayers(rootSeed, deckCount);
  if (deckCount !== 1) throw new RangeError('two or three players play with one deck');
  const rng = new XorShift32(deriveSeed(rootSeed, 'DEAL'));
  const deck = shuffle(createDeck(1), rng);
  const dealt = SMALL_TABLE_HAND[playerCount] * playerCount;
  const hands: Card[][] = [[], [], [], []];
  for (let index = 0; index < dealt; index += 1) hands[index % playerCount]!.push(deck[index]!);
  const firstPlayer = chooseFirstPlayer(hands.slice(0, playerCount), rng);
  return {
    hands,
    buried: deck.slice(dealt),
    dealStartSeat: 0,
    firstPlayer,
    dealStateAfterSetup: rng.snapshot(),
  };
}
