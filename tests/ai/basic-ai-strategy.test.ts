import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { Card, PlayerId, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { PlayPattern } from '../../client/assets/scripts/core/patterns/play-pattern';
import { recognize } from '../../client/assets/scripts/core/patterns/recognize';
import { applyAction } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameState, GouChaChain } from '../../client/assets/scripts/core/state/game-state';
import { buildState } from '../helpers/state-builder';
import { c, group } from '../helpers/cards';

let nextId = 0;
function cards(...ranks: readonly Rank[]): Card[] {
  return ranks.map((rank) => (
    rank === Rank.SMALL_JOKER || rank === Rank.BIG_JOKER
      ? c(`strategy:${nextId++}`, rank, Suit.JOKER)
      : c(`strategy:${nextId++}`, rank)
  ));
}
function times(rank: Rank, count: number): Rank[] {
  return Array.from({ length: count }, () => rank);
}

const { THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN, JACK, QUEEN, KING, ACE, TWO, SMALL_JOKER, BIG_JOKER } = Rank;

/** Five-card hands: nobody is close to finishing unless a test says so. */
function busyHands(): Record<1 | 2 | 3, Card[]> {
  return {
    1: cards(EIGHT, EIGHT, TEN, JACK, QUEEN),
    2: cards(EIGHT, TEN, JACK, QUEEN, KING),
    3: cards(EIGHT, TEN, JACK, QUEEN, KING),
  };
}

function responding(
  hand: readonly Card[],
  table: readonly Card[],
  holderId: 1 | 2 | 3,
  others: Partial<Record<1 | 2 | 3, Card[]>> = {},
): GameState {
  const hands = { ...busyHands(), ...others };
  return buildState({
    phase: 'RESPONDING',
    currentPlayer: 0,
    hands: { 0: hand, ...hands },
    currentPlay: group(table, holderId, 1),
    holderId,
  });
}

function freeLead(hand: readonly Card[]): GameState {
  return buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands: { 0: hand, ...busyHands() } });
}

function gouChaQuery(
  hand: readonly Card[],
  rank: Rank,
  baseOwner: 1 | 2 | 3,
  chaBy: 1 | 2 | 3 | null,
  others: Partial<Record<1 | 2 | 3, Card[]>> = {},
): GameState {
  const base = group(cards(rank), baseOwner, 1);
  const additions: GouChaChain['additions'] = chaBy === null
    ? []
    : [{ addition: 'CHA', playerId: chaBy, cardIds: [`cha:${nextId++}`, `cha:${nextId++}`], actionNumber: 2 }];
  const holderId: PlayerId = chaBy ?? baseOwner;
  return buildState({
    phase: 'GOUCHA_QUERY',
    currentPlayer: 0,
    hands: { 0: hand, ...busyHands(), ...others },
    gouCha: {
      rank,
      basePlay: base,
      additions,
      holderId,
      nextAddition: chaBy === null ? 'CHA' : 'GOU',
      queryCursor: 0,
      declinedPlayerIds: [],
    },
  });
}

interface Decision {
  readonly action: GameAction;
  readonly kind: GameAction['kind'];
  readonly ranks: readonly Rank[];
  readonly pattern: PlayPattern | null;
}

function decide(state: GameState): Decision {
  const action = chooseBasicAiAction(buildObservation(state, 0));
  expect(applyAction(state, action).ok, JSON.stringify(action)).toBe(true);
  const hand = state.players[0].hand;
  const played = 'cardIds' in action ? action.cardIds.map((id) => hand.find((card) => card.id === id)!) : [];
  return {
    action,
    kind: action.kind,
    ranks: played.map((card) => card.rank).sort((left, right) => left - right),
    pattern: played.length === 0 ? null : recognize(played),
  };
}

const table = cards;

describe('basic AI strategy: responding to an opponent', () => {
  it('beats an opponent single with the weakest ordinary card instead of a bomb', () => {
    const decision = decide(responding(cards(FOUR, ...times(NINE, 4), KING), table(THREE), 1));
    expect(decision.kind).toBe('PLAY_CARDS');
    expect(decision.ranks).toEqual([FOUR]);
  });

  it('keeps 4A4 when an ordinary single beats the current play', () => {
    const decision = decide(responding(cards(FIVE, FOUR, FOUR, ACE, KING, KING, QUEEN), table(THREE), 1));
    expect(decision.ranks).toEqual([FIVE]);
  });

  it('spends a whole bomb before splitting its joker bomb', () => {
    const decision = decide(responding(cards(THREE, SMALL_JOKER, BIG_JOKER, NINE, NINE, NINE), table(TWO), 1));
    expect(decision.ranks).toEqual([NINE, NINE, NINE]);
  });

  it('uses the joker bomb before 4A4 when only those beat', () => {
    const decision = decide(responding(cards(SMALL_JOKER, BIG_JOKER, FOUR, FOUR, ACE, THREE), table(...times(FIVE, 4)), 1));
    expect(decision.ranks).toEqual([SMALL_JOKER, BIG_JOKER]);
  });

  it('splits its bombs into an ordinary beat only when no whole bomb beats', () => {
    const decision = decide(responding(
      cards(...times(SIX, 3), ...times(SEVEN, 3), ...times(EIGHT, 3), KING),
      table(THREE, THREE, FOUR, FOUR, FIVE, FIVE),
      1,
    ));
    expect(decision.ranks).toEqual([SIX, SIX, SEVEN, SEVEN, EIGHT, EIGHT]);
  });

  it('answers a pair with the weakest higher pair instead of a six-card bomb', () => {
    const decision = decide(responding(cards(SIX, SIX, ...times(SEVEN, 6), KING), table(THREE, THREE), 1));
    expect(decision.ranks).toEqual([SIX, SIX]);
  });

  it('prefers an ordinary beat that keeps its own bombs intact', () => {
    const decision = decide(responding(cards(FIVE, FIVE, FIVE, SIX, KING), table(FOUR), 1));
    expect(decision.ranks).toEqual([SIX]);
  });

  it('bombs an opponent when no ordinary card beats, even while nobody is close to finishing', () => {
    const decision = decide(responding(cards(THREE, FIVE, EIGHT, NINE, NINE, NINE), table(ACE), 1));
    expect(decision.ranks).toEqual([NINE, NINE, NINE]);
  });

  it('bombs with the weakest whole bomb rather than a split or a bigger one', () => {
    const decision = decide(responding(cards(THREE, FIVE, EIGHT, ...times(NINE, 3), ...times(SEVEN, 4)), table(ACE), 1));
    expect(decision.ranks).toEqual([NINE, NINE, NINE]);
  });

  it('passes when nothing it holds beats the current play', () => {
    const decision = decide(responding(cards(THREE, FIVE, NINE, NINE, NINE), table(...times(KING, 4)), 1));
    expect(decision.kind).toBe('PASS');
  });
});

describe('basic AI strategy: teammate holds the play', () => {
  it('takes over a teammate under threat with an ordinary card, not a bomb', () => {
    const decision = decide(responding(cards(...times(NINE, 4), KING), table(THREE), 2, { 1: cards(ACE, ACE) }));
    expect(decision.ranks).toEqual([KING]);
  });

  it.each([
    ['a bomb', [...times(NINE, 4), THREE]],
    ['a split bomb', [TWO, TWO, TWO, THREE]],
  ] as const)('passes rather than beat a teammate with %s even when an opponent is close to finishing', (_label, hand) => {
    const decision = decide(responding(cards(...hand), table(ACE), 2, { 1: cards(ACE, ACE) }));
    expect(decision.kind).toBe('PASS');
  });

  it('may bomb a teammate when the bomb finishes its hand', () => {
    const decision = decide(responding(cards(...times(NINE, 4)), table(THREE), 2));
    expect(decision.ranks).toEqual(times(NINE, 4));
  });
});

describe('basic AI strategy: one deck, teammate holds, judged by public card counting', () => {
  /**
   * One deck, seat 2 (the teammate) holds the play and seat 1 (an opponent) is close to finishing. Every card
   * outside the four hands counts as played, so the cards the AI has not seen are exactly the other hands.
   */
  function oneDeckTeammateHolds(
    hand: readonly Card[],
    tablePlay: readonly Card[],
    opponents: Record<1 | 3, Card[]>,
  ): GameState {
    return buildState({
      deckCount: 1,
      phase: 'RESPONDING',
      currentPlayer: 0,
      hands: { 0: hand, 1: opponents[1], 2: cards(EIGHT, JACK, QUEEN), 3: opponents[3] },
      currentPlay: group(tablePlay, 2, 1),
      holderId: 2,
    });
  }

  it('lets a teammate single stand when no unseen card can beat it', () => {
    // The other three 2s and both jokers are played, so nothing can beat the teammate's ace.
    const decision = decide(oneDeckTeammateHolds(cards(TWO, FIVE, SIX), table(ACE), {
      1: cards(SEVEN),
      3: cards(EIGHT, TEN, JACK, QUEEN, KING),
    }));
    expect(decision.kind).toBe('PASS');
  });

  it('still takes over when an unseen card could beat the teammate single', () => {
    const decision = decide(oneDeckTeammateHolds(cards(TWO, FIVE, SIX), table(ACE), {
      1: cards(SEVEN),
      3: cards(EIGHT, TEN, JACK, QUEEN, TWO),
    }));
    expect(decision.ranks).toEqual([TWO]);
  });

  it('lets a teammate pair stand when no higher pair can be unseen', () => {
    // It holds two aces and the other two are played; one deck has a single 2 left and no joker pair.
    const decision = decide(oneDeckTeammateHolds(cards(ACE, ACE, FIVE, SIX), table(KING, KING), {
      1: cards(SEVEN),
      3: cards(EIGHT, TEN, JACK, QUEEN, TWO),
    }));
    expect(decision.kind).toBe('PASS');
  });

  it('takes over with the play that starts a go-out plan (R6) instead of the weakest beat', () => {
    // Nothing unseen beats the 2, not even a bomb (no rank has three unseen copies, the jokers and the other
    // 2s are played), and 10-J-Q then goes out as one play; the weakest beat, the 10, plans nothing.
    const decision = decide(oneDeckTeammateHolds(cards(TEN, JACK, QUEEN, TWO), table(NINE), {
      1: cards(SEVEN, EIGHT),
      3: cards(TEN, JACK, QUEEN, KING, ACE),
    }));
    expect(decision.ranks).toEqual([TWO]);
  });

  it('takes over with the weakest beat when no takeover starts a go-out plan', () => {
    const decision = decide(oneDeckTeammateHolds(cards(TEN, JACK, FIVE, TWO), table(NINE), {
      1: cards(SEVEN, EIGHT),
      3: cards(TEN, JACK, QUEEN, KING, ACE),
    }));
    expect(decision.ranks).toEqual([TEN]);
  });
});

/**
 * Every card outside the four hands counts as played, so the cards the AI has not seen are exactly seats 1-3:
 * seats 1 and 3 are opponents, seat 2 the teammate. Without a table play it is the AI's free lead.
 */
function counted(
  deckCount: DeckCount,
  hand: readonly Card[],
  others: Record<1 | 2 | 3, Card[]>,
  play?: { readonly cards: readonly Card[]; readonly holderId: 1 | 2 | 3 },
  finishOrder: readonly PlayerId[] = [],
): GameState {
  return buildState({
    deckCount,
    phase: play === undefined ? 'FREE_LEAD' : 'RESPONDING',
    currentPlayer: 0,
    hands: { 0: hand, ...others },
    ...(play === undefined ? {} : { currentPlay: group(play.cards, play.holderId, 1), holderId: play.holderId }),
    finishOrder,
  });
}

const BOTH_VERSIONS = [1, 2] as const;

describe('basic AI strategy: teammate holds a straight, judged by public card counting', () => {
  /**
   * Seat 1 is down to two cards; the teammate holds 5-6-7 and the AI can top it only with 8-9-10. No go-out
   * plan (R6) applies: the 3 and the 5 left after it could each be beaten.
   */
  function teammateStraight(deckCount: DeckCount, seatThree: Card[]): GameState {
    return counted(
      deckCount,
      cards(EIGHT, NINE, TEN, THREE, FIVE),
      { 1: cards(JACK, KING), 2: cards(THREE, FOUR, NINE), 3: seatThree },
      { cards: table(FIVE, SIX, SEVEN), holderId: 2 },
    );
  }

  it.each(BOTH_VERSIONS)('lets the straight stand when no unseen run of three tops it (%i deck)', (deckCount) => {
    // Unseen runs are 3-4-5 and 4-5-6 at best; 9-10-J and J-Q-K each miss a rank.
    expect(decide(teammateStraight(deckCount, cards(FIVE, SIX, NINE, JACK))).kind).toBe('PASS');
  });

  it.each(BOTH_VERSIONS)('takes over when the unseen cards could make a higher straight (%i deck)', (deckCount) => {
    // The queen completes an unseen J-Q-K.
    expect(decide(teammateStraight(deckCount, cards(FIVE, SIX, NINE, QUEEN))).ranks).toEqual([EIGHT, NINE, TEN]);
  });
});

describe('basic AI strategy: R6 go-out plan (收尾抢权)', () => {
  /**
   * Opponents hold two cards each and the teammate three; no rank has three unseen copies and every 2 and
   * joker is played, so nothing unseen beats a pair of aces or a 2, and no opponent can hold a bomb.
   */
  function quiet(): Record<1 | 2 | 3, Card[]> {
    return { 1: cards(SEVEN, EIGHT), 2: cards(NINE, TEN, JACK), 3: cards(QUEEN, KING) };
  }

  /** Opponents hold four cards each, so nobody is close to finishing (no R3 threat), still without bombs. */
  function calm(teammate: Card[]): Record<1 | 2 | 3, Card[]> {
    return { 1: cards(SEVEN, EIGHT, THREE, FOUR), 2: teammate, 3: cards(QUEEN, KING, THREE, FIVE) };
  }

  describe('free lead', () => {
    it.each(BOTH_VERSIONS)('leads A-A before its last card 6 when no unseen pair beats them (%i deck)', (deckCount) => {
      // R4 alone would lead the 6 and keep the aces back.
      expect(decide(counted(deckCount, cards(SIX, ACE, ACE), quiet())).ranks).toEqual([ACE, ACE]);
    });

    it.each(BOTH_VERSIONS)('still leads the 6 first when an unseen pair of 2s could (%i deck)', (deckCount) => {
      const others = { ...quiet(), 3: cards(TWO, TWO) };
      expect(decide(counted(deckCount, cards(SIX, ACE, ACE), others)).ranks).toEqual([SIX]);
    });

    it.each(BOTH_VERSIONS)('still leads the 6 first when an opponent could hold a bomb (%i deck)', (deckCount) => {
      const others = { 1: cards(SEVEN, EIGHT), 2: cards(TEN, JACK, QUEEN), 3: cards(NINE, NINE, NINE) };
      expect(decide(counted(deckCount, cards(SIX, ACE, ACE), others)).ranks).toEqual([SIX]);
    });

    it.each(BOTH_VERSIONS)('ignores a bomb that only the teammate has room for (%i deck)', (deckCount) => {
      // Three unseen 9s, but each opponent holds two cards, so neither can hold the three-card bomb.
      const others = { 1: cards(SEVEN, EIGHT), 2: cards(NINE, NINE, NINE, TEN), 3: cards(QUEEN, KING) };
      expect(decide(counted(deckCount, cards(SIX, ACE, ACE), others)).ranks).toEqual([ACE, ACE]);
    });

    it('plans a lone small and big joker as the joker bomb (two decks)', () => {
      // The other big joker is unseen, so the small joker alone could be beaten; the joker bomb cannot
      // (no 4A4 is possible), so after A-A only the 6 could be beaten.
      const others = { 1: cards(SEVEN, EIGHT), 2: cards(NINE, TEN, JACK), 3: cards(BIG_JOKER, QUEEN) };
      expect(decide(counted(2, cards(SIX, ACE, ACE, SMALL_JOKER, BIG_JOKER), others)).ranks).toEqual([ACE, ACE]);
    });

    it.each(BOTH_VERSIONS)('still finishes outright (R1) before any go-out plan (%i deck)', (deckCount) => {
      // Each single would start a go-out plan, but Q-K-A empties the hand at once.
      const others = { 1: cards(SEVEN, EIGHT), 2: cards(NINE, TEN, JACK), 3: cards(FIVE, SIX) };
      expect(decide(counted(deckCount, cards(QUEEN, KING, ACE), others)).ranks).toEqual([QUEEN, KING, ACE]);
    });
  });

  describe('opponent holds', () => {
    const opponentFive = (): { cards: Card[]; holderId: 1 } => ({ cards: table(FIVE), holderId: 1 });

    it.each(BOTH_VERSIONS)('beats with the 2 nobody can beat instead of the weakest beat (%i deck)', (deckCount) => {
      expect(decide(counted(deckCount, cards(SIX, TWO), quiet(), opponentFive())).ranks).toEqual([TWO]);
    });

    it.each(BOTH_VERSIONS)('keeps the weakest beat when two beatable plays would remain (%i deck)', (deckCount) => {
      expect(decide(counted(deckCount, cards(SIX, SEVEN, TWO), quiet(), opponentFive())).ranks).toEqual([SIX]);
    });

    it.each(BOTH_VERSIONS)('keeps the weakest beat when an opponent could bomb the 2 (%i deck)', (deckCount) => {
      const others = { 1: cards(SEVEN, EIGHT), 2: cards(TEN, JACK, QUEEN), 3: cards(NINE, NINE, NINE) };
      expect(decide(counted(deckCount, cards(SIX, TWO), others, opponentFive())).ranks).toEqual([SIX]);
    });

    it.each(BOTH_VERSIONS)('does not count a CHA as a beat (%i deck)', (deckCount) => {
      // Seat 3 could CHA the 2 with its pair, but a CHA is an action, not a play that beats.
      const others = { ...quiet(), 3: cards(TWO, TWO) };
      expect(decide(counted(deckCount, cards(SIX, TWO), others, opponentFive())).ranks).toEqual([TWO]);
    });
  });

  describe('teammate holds', () => {
    const teammateFive = (): { cards: Card[]; holderId: 2 } => ({ cards: table(FIVE), holderId: 2 });

    it.each(BOTH_VERSIONS)('takes over without a threat to start a go-out plan (%i deck)', (deckCount) => {
      // R3 alone passes: both opponents hold four cards.
      const state = counted(deckCount, cards(SIX, TWO), calm(cards(NINE, TEN)), teammateFive());
      expect(decide(state).ranks).toEqual([TWO]);
    });

    it.each(BOTH_VERSIONS)('does not take over a teammate down to one card or already out (%i deck)', (deckCount) => {
      const oneCard = counted(deckCount, cards(SIX, TWO), calm(cards(NINE)), teammateFive());
      expect(decide(oneCard).kind).toBe('PASS');
      const out = counted(deckCount, cards(SIX, TWO), calm([]), teammateFive(), [2]);
      expect(decide(out).kind).toBe('PASS');
    });

    it.each([
      ['a bomb', [NINE, NINE, NINE, SIX]],
      ['a split bomb', [TWO, TWO, TWO, SIX]],
    ] as const)('never takes over with %s for a go-out plan', (_label, hand) => {
      // 9-9-9 and the 2s would each start a plan, but R3's bomb rule still holds over a teammate.
      for (const deckCount of BOTH_VERSIONS) {
        const state = counted(deckCount, cards(...hand), calm(cards(NINE, TEN, JACK)), teammateFive());
        expect(decide(state).kind, `${deckCount} deck`).toBe('PASS');
      }
    });
  });
});

describe('basic AI strategy: free lead', () => {
  it('leads low cards before a pair of twos', () => {
    const decision = decide(freeLead(cards(THREE, SEVEN, NINE, TWO, TWO, KING)));
    expect(decision.ranks).toEqual([THREE]);
  });

  it('does not break a bomb to build a straight', () => {
    const decision = decide(freeLead(cards(THREE, FOUR, FIVE, FIVE, FIVE, NINE)));
    expect(decision.ranks).toEqual([THREE]);
  });

  it('leads the loose single beside a three-card bomb instead of splitting it', () => {
    const decision = decide(freeLead(cards(THREE, THREE, THREE, FOUR)));
    expect(decision.ranks).toEqual([FOUR]);
  });

  it('still prefers a long low straight to a lone single of the same low rank', () => {
    const decision = decide(freeLead(cards(THREE, FOUR, FIVE, SIX, SEVEN, KING)));
    expect(decision.ranks).toEqual([THREE, FOUR, FIVE, SIX, SEVEN]);
  });

  it('leads the weakest whole bomb when only bombs remain', () => {
    const decision = decide(freeLead(cards(THREE, THREE, THREE, FOUR, FOUR, FOUR, SMALL_JOKER, BIG_JOKER)));
    expect(decision.ranks).toEqual([THREE, THREE, THREE]);
  });
});

describe('basic AI strategy: gou-cha', () => {
  it('joins with a CHA against an opponent when it holds exactly a pair', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE, KING), FIVE, 1, null));
    expect(decision.action).toMatchObject({ kind: 'ADD_GOUCHA', addition: 'CHA' });
  });

  it('declines a CHA that would split its own bomb', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE, FIVE, KING), FIVE, 1, null));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('keeps its bomb out of a CHA even when an opponent is close to finishing', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE, FIVE, KING), FIVE, 1, null, { 3: cards(TEN, JACK) }));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('declines a GOU that would split its own bomb', () => {
    const decision = decide(gouChaQuery(cards(...times(FIVE, 4), KING), FIVE, 3, 1));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('joins with a GOU when it holds a loose single of the rank', () => {
    const decision = decide(gouChaQuery(cards(FIVE, KING), FIVE, 3, 1));
    expect(decision.action).toMatchObject({ kind: 'ADD_GOUCHA', addition: 'GOU' });
  });

  it('declines a CHA that would destroy its 4A4', () => {
    const decision = decide(gouChaQuery(cards(FOUR, FOUR, ACE, KING), FOUR, 1, null));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('declines a GOU on its teammate\'s CHA even though an opponent played the single', () => {
    const decision = decide(gouChaQuery(cards(FIVE, KING), FIVE, 1, 2));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('joins with a GOU on an opponent\'s CHA of its teammate\'s single', () => {
    const decision = decide(gouChaQuery(cards(FIVE, KING), FIVE, 2, 1));
    expect(decision.action).toMatchObject({ kind: 'ADD_GOUCHA', addition: 'GOU' });
  });

  it('declines gou-cha on a teammate single', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE, KING), FIVE, 2, null));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('always takes a CHA that finishes its hand', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE), FIVE, 2, null));
    expect(decision.action).toMatchObject({ kind: 'ADD_GOUCHA', addition: 'CHA' });
  });
});

describe('basic AI strategy: structure and lead details', () => {
  it('spends the weakest whole bomb before breaking its 4A4 with a single ace', () => {
    const decision = decide(responding(cards(FOUR, FOUR, ACE, SIX, ...times(NINE, 3)), table(KING), 1));
    expect(decision.ranks).toEqual([NINE, NINE, NINE]);
  });

  it('takes over a threatened teammate only with a card outside its bombs', () => {
    const decision = decide(responding(cards(FIVE, FIVE, FIVE, KING), table(FOUR), 2, { 1: cards(ACE, ACE) }));
    expect(decision.ranks).toEqual([KING]);
  });

  it('declines gou-cha on a teammate single even when an opponent is close to finishing', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE, KING), FIVE, 2, null, { 1: cards(TEN, JACK) }));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('leads its lowest card before a pair that starts just above it', () => {
    const decision = decide(freeLead(cards(THREE, FIVE, FIVE, NINE, KING)));
    expect(decision.ranks).toEqual([THREE]);
  });

  it('does not lead a high pair while a lower single exists', () => {
    const decision = decide(freeLead(cards(NINE, JACK, JACK, KING)));
    expect(decision.ranks).toEqual([NINE]);
  });

  it.each([
    ['a pair of 9s, not Q-K-A', [NINE, NINE, QUEEN, KING, ACE, TWO], [NINE, NINE]],
    ['a 7, not a straight ending in A', [SEVEN, TEN, JACK, QUEEN, KING, ACE, TWO], [SEVEN]],
    ['a 9, not a double straight of high pairs', [NINE, QUEEN, QUEEN, KING, KING, ACE, ACE], [NINE]],
    ['a 9, not J-J-Q-Q-K-K', [NINE, JACK, JACK, QUEEN, QUEEN, KING, KING, TWO], [NINE]],
    ['10-J-Q-K, not 10-J-Q-K-A', [TEN, JACK, QUEEN, KING, ACE, TWO, TWO], [TEN, JACK, QUEEN, KING]],
  ] as const)('leads %s', (_label, hand, expected) => {
    const decision = decide(freeLead(cards(...hand)));
    expect(decision.ranks).toEqual(expected);
  });
});
