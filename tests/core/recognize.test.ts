import { describe, expect, it } from 'vitest';
import { Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { recognize } from '../../client/assets/scripts/core/patterns/recognize';
import {
  ace,
  bigJoker,
  c,
  four,
  heartAce,
  heartFour,
  ranks,
  repeatedRanks,
  sameRank,
  smallJoker,
} from '../helpers/cards';

describe('play pattern recognition', () => {
  it.each([
    ['single', [c('a', Rank.THREE)], 'SINGLE'],
    ['pair', [c('a', Rank.FIVE), c('b', Rank.FIVE)], 'PAIR'],
    ['single straight', ranks([Rank.THREE, Rank.FOUR, Rank.FIVE]), 'STRAIGHT'],
    ['double straight', repeatedRanks([Rank.THREE, Rank.FOUR, Rank.FIVE], 2), 'DOUBLE_STRAIGHT'],
    ['triple straight', repeatedRanks([Rank.QUEEN, Rank.KING, Rank.ACE], 3), 'TRIPLE_STRAIGHT'],
    ['three-kind', sameRank(Rank.EIGHT, 3), 'N_OF_KIND_BOMB'],
    ['three 2s', sameRank(Rank.TWO, 3), 'N_OF_KIND_BOMB'],
    ['eight-kind', sameRank(Rank.ACE, 8), 'N_OF_KIND_BOMB'],
    ['joker bomb', [smallJoker(), bigJoker()], 'JOKER_BOMB'],
    ['4A4', [four('a'), four('b'), ace('c')], 'FOUR_A_FOUR'],
    ['heart 4A4', [heartFour('a'), heartFour('b'), heartAce('c')], 'FOUR_A_FOUR'],
  ])('%s', (_name, cards, kind) => expect(recognize(cards).kind).toBe(kind));

  it('marks whether 4A4 is all hearts', () => {
    expect(recognize([heartFour('a'), heartFour('b'), heartAce('c')])).toMatchObject({
      kind: 'FOUR_A_FOUR',
      allHearts: true,
    });
    expect(recognize([four('a'), four('b'), ace('c')])).toMatchObject({
      kind: 'FOUR_A_FOUR',
      allHearts: false,
    });
  });

  it('recognizes same-rank joker pairs', () => {
    expect(recognize([smallJoker(), c('small-2', Rank.SMALL_JOKER, Suit.JOKER)])).toMatchObject({
      kind: 'PAIR',
      rank: Rank.SMALL_JOKER,
    });
    expect(recognize([bigJoker(), c('big-2', Rank.BIG_JOKER, Suit.JOKER)])).toMatchObject({
      kind: 'PAIR',
      rank: Rank.BIG_JOKER,
    });
  });

  it('recognizes the maximum single straight', () => {
    expect(
      recognize(
        ranks([
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
        ]),
      ),
    ).toMatchObject({
      kind: 'STRAIGHT',
      multiplicity: 1,
      runLength: 12,
      low: Rank.THREE,
      high: Rank.ACE,
    });
  });

  it('reports bomb rank and count', () => {
    expect(recognize(sameRank(Rank.ACE, 8))).toMatchObject({
      kind: 'N_OF_KIND_BOMB',
      rank: Rank.ACE,
      count: 8,
    });
  });

  it.each([
    ['empty', [], 'EMPTY'],
    ['duplicate ID', [c('same', Rank.THREE), c('same', Rank.THREE)], 'DUPLICATE_CARD_ID'],
    ['mixed pair', [c('a', Rank.THREE), c('b', Rank.FOUR)], 'MIXED_RANKS'],
    ['short double straight', repeatedRanks([Rank.THREE, Rank.FOUR], 2), 'SEQUENCE_TOO_SHORT'],
    ['gapped straight', ranks([Rank.THREE, Rank.FIVE, Rank.SIX]), 'SEQUENCE_GAP'],
    ['straight with 2', ranks([Rank.QUEEN, Rank.KING, Rank.ACE, Rank.TWO]), 'SEQUENCE_FORBIDDEN_RANK'],
    ['uneven multiplicity', [...sameRank(Rank.THREE, 2), c('x', Rank.FOUR)], 'SEQUENCE_MULTIPLICITY'],
    ['quadruple straight', repeatedRanks([Rank.THREE, Rank.FOUR, Rank.FIVE], 4), 'SEQUENCE_MULTIPLICITY'],
    ['joker bomb with extra card', [smallJoker(), bigJoker(), c('x', Rank.THREE)], 'UNSUPPORTED_COMBINATION'],
  ])('rejects %s', (_name, cards, reason) => expect(recognize(cards)).toEqual({ kind: 'INVALID', reason }));
});
