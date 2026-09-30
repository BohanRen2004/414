import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { beats, PlayPattern, Rank } from '../../client/assets/scripts/core';

type StraightPattern = Extract<
  PlayPattern,
  { kind: 'STRAIGHT' | 'DOUBLE_STRAIGHT' | 'TRIPLE_STRAIGHT' }
>;

const single = (rank: Rank): PlayPattern => ({ kind: 'SINGLE', rank });
const pair = (rank: Rank): PlayPattern => ({ kind: 'PAIR', rank });
const straight = (multiplicity: 1 | 2 | 3, runLength: number, high: Rank): PlayPattern => ({
  kind: ['STRAIGHT', 'DOUBLE_STRAIGHT', 'TRIPLE_STRAIGHT'][multiplicity - 1] as StraightPattern['kind'],
  multiplicity,
  runLength,
  low: (high - runLength + 1) as Rank,
  high,
});
const bomb = (count: number, rank: Rank): PlayPattern => ({ kind: 'N_OF_KIND_BOMB', count, rank });
const jokerBomb = (): PlayPattern => ({ kind: 'JOKER_BOMB' });
const fourA4 = (allHearts: boolean): PlayPattern => ({ kind: 'FOUR_A_FOUR', allHearts });
const invalid = (): PlayPattern => ({ kind: 'INVALID', reason: 'EMPTY' });

describe('strict play comparison', () => {
  describe('decision table', () => {
    it.each([
      [
        'single',
        single(Rank.THREE),
        [single(Rank.FOUR), bomb(3, Rank.THREE), jokerBomb(), fourA4(false)],
      ],
      [
        'pair',
        pair(Rank.THREE),
        [pair(Rank.FOUR), bomb(3, Rank.THREE), jokerBomb(), fourA4(false)],
      ],
      [
        'single straight',
        straight(1, 3, Rank.FIVE),
        [straight(1, 3, Rank.SIX), bomb(3, Rank.THREE), jokerBomb(), fourA4(false)],
      ],
      [
        'double straight',
        straight(2, 3, Rank.FIVE),
        [straight(2, 3, Rank.SIX), bomb(4, Rank.THREE), jokerBomb(), fourA4(false)],
      ],
      [
        'triple straight',
        straight(3, 3, Rank.FIVE),
        [straight(3, 3, Rank.SIX), bomb(5, Rank.THREE), jokerBomb(), fourA4(false)],
      ],
      [
        'n-of-kind bomb',
        bomb(3, Rank.THREE),
        [bomb(4, Rank.THREE), bomb(3, Rank.FOUR), jokerBomb(), fourA4(false)],
      ],
      ['joker bomb', jokerBomb(), [fourA4(false), fourA4(true)]],
      ['regular 4A4', fourA4(false), [fourA4(true)]],
    ] satisfies ReadonlyArray<readonly [string, PlayPattern, readonly PlayPattern[]]>) (
      'accepts every listed winner against %s',
      (_name, current, winners) => {
        for (const candidate of winners) expect(beats(candidate, current)).toBe(true);
      },
    );

    it('has no winner against heart 4A4', () => {
      const representatives = [
        single(Rank.BIG_JOKER),
        pair(Rank.BIG_JOKER),
        straight(3, 3, Rank.ACE),
        bomb(8, Rank.TWO),
        jokerBomb(),
        fourA4(false),
        fourA4(true),
      ];

      for (const candidate of representatives) expect(beats(candidate, fourA4(true))).toBe(false);
    });
  });

  describe('ordinary plays', () => {
    it('compares singles and pairs by strictly higher rank', () => {
      expect(beats(single(Rank.FOUR), single(Rank.THREE))).toBe(true);
      expect(beats(single(Rank.THREE), single(Rank.FOUR))).toBe(false);
      expect(beats(single(Rank.FOUR), single(Rank.FOUR))).toBe(false);
      expect(beats(pair(Rank.FOUR), pair(Rank.THREE))).toBe(true);
      expect(beats(pair(Rank.THREE), pair(Rank.FOUR))).toBe(false);
      expect(beats(pair(Rank.FOUR), pair(Rank.FOUR))).toBe(false);
    });

    it('rejects different ordinary kinds', () => {
      expect(beats(pair(Rank.FOUR), single(Rank.THREE))).toBe(false);
      expect(beats(single(Rank.ACE), pair(Rank.THREE))).toBe(false);
      expect(beats(straight(2, 3, Rank.FIVE), straight(1, 3, Rank.FIVE))).toBe(false);
    });

    it('compares straights only when kind and run length match', () => {
      expect(beats(straight(1, 3, Rank.SIX), straight(1, 3, Rank.FIVE))).toBe(true);
      expect(beats(straight(2, 3, Rank.SIX), straight(2, 3, Rank.FIVE))).toBe(true);
      expect(beats(straight(3, 3, Rank.SIX), straight(3, 3, Rank.FIVE))).toBe(true);
      expect(beats(straight(1, 3, Rank.FIVE), straight(1, 3, Rank.SIX))).toBe(false);
      expect(beats(straight(1, 3, Rank.FIVE), straight(1, 3, Rank.FIVE))).toBe(false);
      expect(beats(straight(1, 4, Rank.SIX), straight(1, 3, Rank.FIVE))).toBe(false);
    });

    it('never lets an ordinary play beat a bomb', () => {
      expect(beats(single(Rank.BIG_JOKER), bomb(3, Rank.THREE))).toBe(false);
      expect(beats(pair(Rank.BIG_JOKER), bomb(3, Rank.THREE))).toBe(false);
      expect(beats(straight(3, 3, Rank.ACE), bomb(3, Rank.THREE))).toBe(false);
    });
  });

  describe('n-of-kind bombs', () => {
    it('compares count before rank and requires a strict win', () => {
      expect(beats(bomb(4, Rank.THREE), bomb(3, Rank.ACE))).toBe(true);
      expect(beats(bomb(3, Rank.ACE), bomb(4, Rank.THREE))).toBe(false);
      expect(beats(bomb(3, Rank.FOUR), bomb(3, Rank.THREE))).toBe(true);
      expect(beats(bomb(3, Rank.THREE), bomb(3, Rank.FOUR))).toBe(false);
      expect(beats(bomb(3, Rank.THREE), bomb(3, Rank.THREE))).toBe(false);
    });

    it('beats singles and pairs at the minimum bomb size', () => {
      expect(beats(bomb(3, Rank.THREE), single(Rank.BIG_JOKER))).toBe(true);
      expect(beats(bomb(3, Rank.THREE), pair(Rank.BIG_JOKER))).toBe(true);
      expect(beats(bomb(2, Rank.ACE), single(Rank.THREE))).toBe(false);
      expect(beats(bomb(2, Rank.ACE), pair(Rank.THREE))).toBe(false);
    });

    it.each([
      ['single straight', 1 as const, 3, true],
      ['double straight', 2 as const, 3, false],
      ['double straight', 2 as const, 4, true],
      ['triple straight', 3 as const, 3, false],
      ['triple straight', 3 as const, 4, false],
      ['triple straight', 3 as const, 5, true],
    ])('applies the %s bomb-size threshold (multiplicity %i, bomb count %i)', (
      _name,
      multiplicity,
      count,
      expected,
    ) => {
      expect(beats(bomb(count, Rank.THREE), straight(multiplicity, 3, Rank.FIVE))).toBe(expected);
    });

    it('does not let rank compensate for being below a straight threshold', () => {
      expect(beats(bomb(3, Rank.THREE), straight(1, 12, Rank.ACE))).toBe(true);
      expect(beats(bomb(3, Rank.ACE), straight(2, 3, Rank.FIVE))).toBe(false);
      expect(beats(bomb(4, Rank.THREE), straight(2, 3, Rank.FIVE))).toBe(true);
      expect(beats(bomb(4, Rank.ACE), straight(3, 3, Rank.FIVE))).toBe(false);
      expect(beats(bomb(5, Rank.THREE), straight(3, 3, Rank.FIVE))).toBe(true);
    });
  });

  describe('top combinations', () => {
    it('orders joker bombs above all ordinary and n-of-kind bombs but not themselves', () => {
      expect(beats(jokerBomb(), single(Rank.BIG_JOKER))).toBe(true);
      expect(beats(jokerBomb(), bomb(8, Rank.ACE))).toBe(true);
      expect(beats(jokerBomb(), jokerBomb())).toBe(false);
      expect(beats(bomb(8, Rank.ACE), jokerBomb())).toBe(false);
    });

    it('orders regular and heart 4A4 at the top without ties winning', () => {
      expect(beats(fourA4(false), jokerBomb())).toBe(true);
      expect(beats(jokerBomb(), fourA4(false))).toBe(false);
      expect(beats(fourA4(false), fourA4(false))).toBe(false);
      expect(beats(fourA4(true), fourA4(false))).toBe(true);
      expect(beats(fourA4(false), fourA4(true))).toBe(false);
      expect(beats(fourA4(true), fourA4(true))).toBe(false);
    });
  });

  it('rejects INVALID in either comparison position', () => {
    expect(beats(invalid(), single(Rank.THREE))).toBe(false);
    expect(beats(single(Rank.FOUR), invalid())).toBe(false);
    expect(beats(invalid(), invalid())).toBe(false);
  });

  it('is irreflexive for generated valid recognized patterns', () => {
    const rankArbitrary = fc.integer({ min: Rank.THREE, max: Rank.BIG_JOKER }).map((rank) => rank as Rank);
    const ordinaryRankArbitrary = fc.integer({ min: Rank.THREE, max: Rank.TWO }).map((rank) => rank as Rank);
    const straightArbitrary = fc
      .tuple(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: Rank.THREE, max: Rank.QUEEN }),
        fc.integer({ min: Rank.FIVE, max: Rank.ACE }),
      )
      .filter(([, low, high]) => high - low >= 2)
      .map(([multiplicity, low, high]) => straight(
        multiplicity as 1 | 2 | 3,
        high - low + 1,
        high as Rank,
      ));
    const validPatternArbitrary: fc.Arbitrary<PlayPattern> = fc.oneof(
      rankArbitrary.map(single),
      rankArbitrary.map(pair),
      straightArbitrary,
      fc.tuple(fc.integer({ min: 3, max: 8 }), ordinaryRankArbitrary).map(([count, rank]) => bomb(count, rank)),
      fc.constant(jokerBomb()),
      fc.boolean().map(fourA4),
    );

    fc.assert(fc.property(validPatternArbitrary, (pattern) => {
      expect(beats(pattern, pattern)).toBe(false);
    }), { numRuns: 500 });
  });
});
