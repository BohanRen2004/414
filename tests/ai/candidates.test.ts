import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { generateCandidates } from '../../client/assets/scripts/ai/candidates';
import { Card, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck } from '../../client/assets/scripts/core/cards/deck';
import { recognize } from '../../client/assets/scripts/core/patterns/recognize';
import { applyAction } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { buildState } from '../helpers/state-builder';
import { c, group } from '../helpers/cards';

function buildHand(): Card[] {
  const deck = createDoubleDeck();
  const hand: Card[] = [];
  for (let rank = Rank.THREE; rank <= Rank.NINE; rank += 1) {
    const cards = deck.filter((card) => card.rank === rank);
    hand.push(...(rank === Rank.FOUR
      ? [...cards.filter((card) => card.suit === Suit.HEART), ...cards.filter((card) => card.suit !== Suit.HEART)].slice(0, 3)
      : cards.slice(0, 3)));
  }
  hand.push(...deck.filter((card) => card.rank === Rank.TEN).slice(0, 2));
  hand.push(...deck.filter((card) => card.rank === Rank.ACE && card.suit === Suit.HEART).slice(0, 1));
  hand.push(...deck.filter((card) => card.rank === Rank.SMALL_JOKER).slice(0, 1));
  hand.push(...deck.filter((card) => card.rank === Rank.BIG_JOKER).slice(0, 1));
  hand.push(...deck.filter((card) => card.rank === Rank.TWO).slice(0, 1));
  return hand;
}

function sourceState(phase: 'FREE_LEAD' | 'RESPONDING' = 'FREE_LEAD') {
  const hand = buildHand();
  const otherHands = { 0: hand, 1: [] as Card[], 2: [] as Card[], 3: [] as Card[] };
  if (phase === 'FREE_LEAD') return buildState({ phase, currentPlayer: 0, hands: otherHands });
  const currentPlay = group([c('public-five', Rank.FIVE)], 1, 1);
  return buildState({ phase, currentPlayer: 0, hands: otherHands, currentPlay, holderId: 1 });
}

function assertCandidatesAccepted(state: ReturnType<typeof sourceState>, actions: readonly GameAction[]): void {
  for (const action of actions) expect(applyAction(state, action).ok, JSON.stringify(action)).toBe(true);
}

describe('structure-first AI candidates', () => {
  it('covers singles, pairs, contiguous windows, bombs, joker bomb, and 4A4', () => {
    const state = sourceState();
    const actions = generateCandidates(buildObservation(state, 0));
    const plays = actions.filter((action) => action.kind === 'PLAY_CARDS');
    const patterns = plays.map((action) => action.kind === 'PLAY_CARDS'
      ? recognize(action.cardIds.map((id) => state.players[0].hand.find((card) => card.id === id)!))
      : null);

    expect(patterns.some((pattern) => pattern?.kind === 'SINGLE')).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'PAIR')).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'STRAIGHT')).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'DOUBLE_STRAIGHT')).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'TRIPLE_STRAIGHT')).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'N_OF_KIND_BOMB' && pattern.count === 3)).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'JOKER_BOMB')).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'FOUR_A_FOUR' && pattern.allHearts)).toBe(true);
    expect(patterns.some((pattern) => pattern?.kind === 'FOUR_A_FOUR' && !pattern.allHearts)).toBe(true);
    for (const multiplicity of [1, 2, 3] as const) {
      const kind = multiplicity === 1 ? 'STRAIGHT' : multiplicity === 2 ? 'DOUBLE_STRAIGHT' : 'TRIPLE_STRAIGHT';
      for (let low = Rank.THREE; low <= Rank.NINE; low += 1) {
        for (let high = low + 2; high <= Rank.NINE; high += 1) {
          expect(patterns.some((pattern) => pattern !== null && 'low' in pattern
            && pattern.kind === kind && pattern.low === low && pattern.high === high), `${kind} ${low}..${high}`).toBe(true);
        }
      }
    }
    assertCandidatesAccepted(state, actions);
  });

  it('adds Pass in response and every emitted play beats the public current play', () => {
    const state = sourceState('RESPONDING');
    const actions = generateCandidates(buildObservation(state, 0));
    expect(actions.some((action) => action.kind === 'PASS')).toBe(true);
    expect(actions.every((action) => action.kind !== 'PLAY_CARDS'
      || applyAction(state, action).ok)).toBe(true);
    assertCandidatesAccepted(state, actions);
  });

  it('offers only the permitted CHA/GOU addition and decline during a query', () => {
    const deck = createDoubleDeck();
    const fives = deck.filter((card) => card.rank === Rank.FIVE);
    const filler = deck.filter((card) => card.rank !== Rank.FIVE && card.rank !== Rank.SMALL_JOKER && card.rank !== Rank.BIG_JOKER);
    const hand = [fives[0]!, fives[1]!, filler[0]!];
    const base = group([c('base-five', Rank.FIVE)], 0, 1);
    const chaState = buildState({
      phase: 'GOUCHA_QUERY', currentPlayer: 1,
      hands: { 0: [filler[1]!], 1: hand, 2: [fives[2]!, filler[2]!], 3: [filler[3]!] },
      gouCha: {
        rank: Rank.FIVE, basePlay: base, additions: [], aggregateCardIds: ['base-five'],
        aggregatePattern: { kind: 'SINGLE', rank: Rank.FIVE }, holderId: 0,
        nextAddition: 'CHA', queryCursor: 0, declinedPlayerIds: [],
      },
    });
    const chaActions = generateCandidates(buildObservation(chaState, 1));
    expect(chaActions.map((action) => action.kind).sort()).toEqual(['ADD_GOUCHA', 'DECLINE_GOUCHA']);
    expect(chaActions.filter((action) => action.kind === 'ADD_GOUCHA')
      .every((action) => action.addition === 'CHA' && action.cardIds.length === 2)).toBe(true);
    assertCandidatesAccepted(chaState, chaActions);

    const gouState = buildState({
      phase: 'GOUCHA_QUERY', currentPlayer: 2,
      hands: { 0: [filler[4]!], 1: [fives[3]!, filler[5]!], 2: [fives[4]!, filler[6]!], 3: [filler[7]!] },
      gouCha: {
        rank: Rank.FIVE, basePlay: base,
        additions: [{ addition: 'CHA', playerId: 1, cardIds: ['cha-five-a', 'cha-five-b'], actionNumber: 2 }],
        aggregateCardIds: ['base-five', 'cha-five-a', 'cha-five-b'],
        aggregatePattern: { kind: 'N_OF_KIND_BOMB', rank: Rank.FIVE, count: 3 },
        holderId: 1, nextAddition: 'GOU', queryCursor: 1, declinedPlayerIds: [],
      },
    });
    const gouActions = generateCandidates(buildObservation(gouState, 2));
    expect(gouActions.map((action) => action.kind).sort()).toEqual(['ADD_GOUCHA', 'DECLINE_GOUCHA']);
    expect(gouActions.filter((action) => action.kind === 'ADD_GOUCHA')
      .every((action) => action.addition === 'GOU' && action.cardIds.length === 1)).toBe(true);
    assertCandidatesAccepted(gouState, gouActions);

    const noCardsState = buildState({
      phase: 'GOUCHA_QUERY', currentPlayer: 1,
      hands: { 0: [filler[8]!], 1: [filler[9]!], 2: [filler[10]!], 3: [filler[11]!] },
      gouCha: {
        rank: Rank.FIVE, basePlay: base, additions: [], aggregateCardIds: ['base-five'],
        aggregatePattern: { kind: 'SINGLE', rank: Rank.FIVE }, holderId: 0,
        nextAddition: 'CHA', queryCursor: 0, declinedPlayerIds: [],
      },
    });
    const declineOnly = generateCandidates(buildObservation(noCardsState, 1));
    expect(declineOnly.map((action) => action.kind))
      .toEqual(['DECLINE_GOUCHA']);
    assertCandidatesAccepted(noCardsState, declineOnly);
  });

  it('keeps the adversarial 27-card candidate set structurally bounded', () => {
    const denseRanks = [Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK] as const;
    const deck = createDoubleDeck();
    const hand = denseRanks.flatMap((rank) => deck.filter((card) => card.rank === rank).slice(0, 3));
    const state = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands: { 0: hand, 1: [], 2: [], 3: [] } });
    expect(generateCandidates(buildObservation(state, 0)).length).toBeLessThan(512);
  });
});
