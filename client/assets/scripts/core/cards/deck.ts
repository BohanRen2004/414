import { Card, PlayerId, Rank, Suit } from './card';
import { deriveSeed, RandomSource, XorShift32 } from '../random/prng';

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

export function createDoubleDeck(): readonly Card[] {
  const cards: Card[] = [];

  for (const deckIndex of [0, 1] as const) {
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

export function shuffle<T>(source: readonly T[], rng: RandomSource): T[] {
  const shuffled = [...source];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function dealFourPlayers(rootSeed: number): {
  readonly hands: readonly (readonly Card[])[];
  readonly firstPlayer: PlayerId;
  readonly dealStateAfterSetup: number;
} {
  const rng = new XorShift32(deriveSeed(rootSeed, 'DEAL'));
  const deck = shuffle(createDoubleDeck(), rng);
  const hands: Card[][] = [[], [], [], []];

  for (let index = 0; index < deck.length; index += 1) {
    hands[index % 4]!.push(deck[index]!);
  }

  const firstPlayer = rng.nextInt(4) as PlayerId;
  return {
    hands,
    firstPlayer,
    dealStateAfterSetup: rng.snapshot(),
  };
}
