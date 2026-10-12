import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { Card, PlayerId, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
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
  const aggregateCardIds = [...base.cardIds, ...additions.flatMap((addition) => addition.cardIds)];
  const holderId: PlayerId = chaBy ?? baseOwner;
  return buildState({
    phase: 'GOUCHA_QUERY',
    currentPlayer: 0,
    hands: { 0: hand, ...busyHands(), ...others },
    gouCha: {
      rank,
      basePlay: base,
      additions,
      aggregateCardIds,
      aggregatePattern: chaBy === null
        ? { kind: 'SINGLE', rank }
        : { kind: 'N_OF_KIND_BOMB', rank, count: aggregateCardIds.length },
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

const bombKinds = new Set<PlayPattern['kind']>(['N_OF_KIND_BOMB', 'JOKER_BOMB', 'FOUR_A_FOUR']);
function isBomb(decision: Decision): boolean {
  return decision.pattern !== null && bombKinds.has(decision.pattern.kind);
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

  it('keeps the joker bomb when an ordinary single beats the current play', () => {
    const decision = decide(responding(cards(FIVE, EIGHT, TEN, SMALL_JOKER, BIG_JOKER), table(THREE), 1));
    expect(decision.ranks).toEqual([FIVE]);
  });

  it('answers a pair with the weakest higher pair instead of a six-card bomb', () => {
    const decision = decide(responding(cards(SIX, SIX, ...times(SEVEN, 6), KING), table(THREE, THREE), 1));
    expect(decision.ranks).toEqual([SIX, SIX]);
  });

  it('prefers an ordinary beat that keeps its own bombs intact', () => {
    const decision = decide(responding(cards(FIVE, FIVE, FIVE, SIX, KING), table(FOUR), 1));
    expect(decision.ranks).toEqual([SIX]);
  });

  it('passes instead of bombing while no opponent is close to finishing', () => {
    const decision = decide(responding(cards(THREE, FIVE, EIGHT, NINE, NINE, NINE), table(ACE), 1));
    expect(decision.kind).toBe('PASS');
  });

  it.each([
    ['the holder', 1],
    ['the other opponent', 3],
  ] as const)('bombs with the weakest whole bomb when %s has at most three cards', (_label, threatSeat) => {
    const decision = decide(responding(
      cards(THREE, FIVE, EIGHT, ...times(NINE, 3), ...times(SEVEN, 4)),
      table(ACE),
      1,
      { [threatSeat]: cards(TEN, JACK) },
    ));
    expect(decision.kind).toBe('PLAY_CARDS');
    expect(decision.ranks).toEqual([NINE, NINE, NINE]);
  });

  it('bombs when the rest of its hand can then be played out in one go', () => {
    const decision = decide(responding(cards(NINE, NINE, NINE, FIVE, SIX, SEVEN), table(ACE), 1));
    expect(decision.ranks).toEqual([NINE, NINE, NINE]);
  });
});

describe('basic AI strategy: teammate holds the play', () => {
  it('never bombs a teammate even when an opponent is close to finishing', () => {
    const decision = decide(responding(cards(...times(NINE, 4), KING), table(THREE), 2, { 1: cards(ACE, ACE) }));
    expect(isBomb(decision)).toBe(false);
  });

  it('may bomb a teammate when the bomb finishes its hand', () => {
    const decision = decide(responding(cards(...times(NINE, 4)), table(THREE), 2));
    expect(decision.ranks).toEqual(times(NINE, 4));
  });
});

describe('basic AI strategy: free lead', () => {
  it('leads low cards before a pair of twos', () => {
    const decision = decide(freeLead(cards(THREE, SEVEN, NINE, TWO, TWO, KING)));
    expect(decision.ranks).toEqual([THREE]);
  });

  it('does not break a bomb to build a straight', () => {
    const decision = decide(freeLead(cards(THREE, FIVE, EIGHT, ...times(TEN, 4), JACK, QUEEN)));
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

  it('splits its bomb for a CHA when an opponent is close to finishing', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE, FIVE, KING), FIVE, 1, null, { 3: cards(TEN, JACK) }));
    expect(decision.action).toMatchObject({ kind: 'ADD_GOUCHA', addition: 'CHA' });
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

  it('declines gou-cha on a teammate single', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE, KING), FIVE, 2, null));
    expect(decision.kind).toBe('DECLINE_GOUCHA');
  });

  it('always takes a CHA that finishes its hand', () => {
    const decision = decide(gouChaQuery(cards(FIVE, FIVE), FIVE, 2, null));
    expect(decision.action).toMatchObject({ kind: 'ADD_GOUCHA', addition: 'CHA' });
  });
});
