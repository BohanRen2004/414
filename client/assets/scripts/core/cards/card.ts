export enum Suit {
  CLUB,
  DIAMOND,
  HEART,
  SPADE,
  JOKER,
}

export enum Rank {
  THREE,
  FOUR,
  FIVE,
  SIX,
  SEVEN,
  EIGHT,
  NINE,
  TEN,
  JACK,
  QUEEN,
  KING,
  ACE,
  TWO,
  SMALL_JOKER,
  BIG_JOKER,
}

export interface Card {
  readonly id: string;
  readonly deckIndex: 0 | 1;
  readonly rank: Rank;
  readonly suit: Suit;
}

export type PlayerId = 0 | 1 | 2 | 3;
/** Four players play two teams (seats 0+2 and 1+3); two or three players each play alone, a team of one. */
export type TeamId = 0 | 1 | 2 | 3;
