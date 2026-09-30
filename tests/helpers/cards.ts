import { Card, PlayerId, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { CardGroup } from '../../client/assets/scripts/core/patterns/play-pattern';
import { recognize } from '../../client/assets/scripts/core/patterns/recognize';

const ordinarySuits = [Suit.CLUB, Suit.DIAMOND, Suit.HEART, Suit.SPADE] as const;

export function c(id: string, rank: Rank, suit?: Suit): Card {
  if (suit !== undefined) return { id, rank, suit, deckIndex: 0 };
  const fixtureCard = { id, rank, suit: Suit.CLUB, deckIndex: 0 as const, __fixtureFlexibleSuit: true };
  return fixtureCard;
}

export function hasFlexibleFixtureSuit(card: Card): boolean {
  return (card as Card & { readonly __fixtureFlexibleSuit?: boolean }).__fixtureFlexibleSuit === true;
}

export function sameRank(rank: Rank, count: number): Card[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${rank}:${index}`,
    rank,
    suit: ordinarySuits[index % 4]!,
    deckIndex: index < 4 ? 0 : 1,
  }));
}

export function ranks(values: readonly Rank[]): Card[] {
  return values.map((rank, index) => c(`rank:${rank}:${index}`, rank));
}

export function repeatedRanks(values: readonly Rank[], count: number): Card[] {
  return values.flatMap((rank) => sameRank(rank, count).map((card) => ({ ...card, id: `${rank}:${card.id}` })));
}

export const smallJoker = (): Card => c('small', Rank.SMALL_JOKER, Suit.JOKER);
export const bigJoker = (): Card => c('big', Rank.BIG_JOKER, Suit.JOKER);
export const four = (id: string): Card => c(id, Rank.FOUR);
export const ace = (id: string): Card => c(id, Rank.ACE);
export const heartFour = (id: string): Card => c(id, Rank.FOUR, Suit.HEART);
export const heartAce = (id: string): Card => c(id, Rank.ACE, Suit.HEART);
export const five = (id: string): Card => c(id, Rank.FIVE);

export function group(cards: readonly Card[], playerId: PlayerId, actionNumber: number): CardGroup {
  const pattern = recognize(cards);
  if (pattern.kind === 'INVALID') throw new Error(`Invalid test group: ${pattern.reason}`);
  return { cardIds: cards.map((card) => card.id), pattern, playerId, actionNumber };
}
