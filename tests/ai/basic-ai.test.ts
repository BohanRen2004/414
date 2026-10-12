import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction, chooseFromCandidates } from '../../client/assets/scripts/ai/basic-ai';
import { Card, Rank } from '../../client/assets/scripts/core/cards/card';
import { CardGroup } from '../../client/assets/scripts/core/patterns/play-pattern';
import { applyAction } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { buildState } from '../helpers/state-builder';
import { c, group, sameRank } from '../helpers/cards';

function buildFreeLead(hand: readonly Card[]) {
  return buildState({
    phase: 'FREE_LEAD',
    currentPlayer: 0,
    hands: {
      0: hand,
      1: [c('seat1', Rank.SEVEN)],
      2: [c('seat2', Rank.EIGHT)],
      3: [c('seat3', Rank.NINE)],
    },
  });
}

function ranks(values: readonly Rank[]) {
  return values.map((rank, index) => c(`lead:${rank}:${index}`, rank));
}

function buildResponding(
  hand: ReturnType<typeof ranks>,
  holderId: 1 | 2 | 3,
  holderRank: Rank,
  otherHands: { readonly 1: ReturnType<typeof ranks>; readonly 2: ReturnType<typeof ranks>; readonly 3: ReturnType<typeof ranks> },
) {
  const currentPlay = group([c(`table:${holderRank}`, holderRank)], holderId, 1);
  return buildState({
    phase: 'RESPONDING',
    currentPlayer: 0,
    hands: { 0: hand, 1: otherHands[1], 2: otherHands[2], 3: otherHands[3] },
    currentPlay,
    holderId,
  });
}

function buildRespondingToGroup(hand: readonly Card[], currentPlay: CardGroup) {
  return buildState({
    phase: 'RESPONDING',
    currentPlayer: 0,
    hands: {
      0: hand,
      1: sameRank(Rank.TWO, 4),
      2: [c('group-seat2', Rank.THREE)],
      3: sameRank(Rank.JACK, 4),
    },
    currentPlay,
    holderId: currentPlay.playerId,
  });
}

function assertAccepted(state: ReturnType<typeof buildState>, action: GameAction): void {
  expect(applyAction(state, action).ok, JSON.stringify(action)).toBe(true);
}

describe('basic AI action selection', () => {
  it('prioritizes an immediate finish', () => {
    const state = buildFreeLead([c('last-card', Rank.SEVEN)]);
    const observation = buildObservation(state, 0);
    const action = chooseBasicAiAction(observation);
    expect(action).toEqual({ kind: 'PLAY_CARDS', playerId: 0, cardIds: ['last-card'] });
    assertAccepted(state, action);
  });

  it('passes when no legal response beats the current play', () => {
    const state = buildResponding(
      ranks([Rank.THREE, Rank.FOUR, Rank.FIVE]),
      1,
      Rank.TWO,
      { 1: ranks([Rank.SIX]), 2: ranks([Rank.SEVEN]), 3: ranks([Rank.EIGHT]) },
    );
    const action = chooseBasicAiAction(buildObservation(state, 0));
    expect(action).toMatchObject({ kind: 'PASS' });
    assertAccepted(state, action);
  });

  it('leads ordinary cards instead of spending a three-card bomb', () => {
    const state = buildFreeLead([...sameRank(Rank.THREE, 3), ...sameRank(Rank.FOUR, 1)]);
    const action = chooseBasicAiAction(buildObservation(state, 0));
    expect(action.kind).toBe('PLAY_CARDS');
    if (action.kind === 'PLAY_CARDS') expect(action.cardIds).toEqual([state.players[0].hand[3]!.id]);
    assertAccepted(state, action);
  });

  it('prefers a long sequence to isolated singles when it sheds more cards', () => {
    const state = buildFreeLead(ranks([Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX]));
    const action = chooseBasicAiAction(buildObservation(state, 0));
    expect(action.kind).toBe('PLAY_CARDS');
    if (action.kind === 'PLAY_CARDS') expect(action.cardIds).toHaveLength(4);
    assertAccepted(state, action);
  });

  it('usually passes rather than overtaking a teammate who holds the play', () => {
    const state = buildResponding(
      ranks([Rank.ACE, Rank.THREE]),
      2,
      Rank.FIVE,
      { 1: sameRank(Rank.SEVEN, 4), 2: [c('holder-five', Rank.FIVE)], 3: sameRank(Rank.EIGHT, 4) },
    );
    const action = chooseBasicAiAction(buildObservation(state, 0));
    expect(action).toMatchObject({ kind: 'PASS' });
    assertAccepted(state, action);
  });

  it('intercepts a threatened opponent holder with one card left', () => {
    const state = buildResponding(
      ranks([Rank.SIX]),
      1,
      Rank.FIVE,
      { 1: [c('threat-card', Rank.KING)], 2: sameRank(Rank.SEVEN, 4), 3: sameRank(Rank.EIGHT, 4) },
    );
    const action = chooseBasicAiAction(buildObservation(state, 0));
    expect(action).toMatchObject({ kind: 'PLAY_CARDS' });
    assertAccepted(state, action);
  });

  it('still overtakes a teammate when the play immediately finishes the hand', () => {
    const state = buildResponding(
      ranks([Rank.ACE]),
      2,
      Rank.FIVE,
      { 1: sameRank(Rank.SEVEN, 4), 2: [c('finish-holder', Rank.FIVE)], 3: sameRank(Rank.EIGHT, 4) },
    );
    const action = chooseBasicAiAction(buildObservation(state, 0));
    expect(action).toMatchObject({ kind: 'PLAY_CARDS' });
    assertAccepted(state, action);
  });

  it('allows a significant longer straight to overtake a teammate', () => {
    const currentPlay = group(ranks([Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT]), 2, 1);
    const state = buildRespondingToGroup(
      [...ranks([Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT, Rank.NINE]), c('extra-card', Rank.KING)],
      currentPlay,
    );
    const action = chooseBasicAiAction(buildObservation(state, 0));
    expect(action.kind).toBe('PLAY_CARDS');
    if (action.kind === 'PLAY_CARDS') expect(action.cardIds).toHaveLength(6);
    assertAccepted(state, action);
  });

  it('returns the same action for the same observation and seed state', () => {
    const state = buildFreeLead(ranks([Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX]));
    const observation = buildObservation(state, 0);
    expect(chooseBasicAiAction(observation)).toEqual(chooseBasicAiAction(observation));
  });

  it('is order-independent for tied candidates and uses the observation random value to break ties', () => {
    const state = buildFreeLead(sameRank(Rank.THREE, 2));
    const observation = buildObservation(state, 0);
    const candidates: GameAction[] = state.players[0].hand.map((card) => ({
      kind: 'PLAY_CARDS', playerId: 0, cardIds: [card.id],
    }));
    const zeroRandom = { ...observation, decisionRandom: 0 };
    const oneRandom = { ...observation, decisionRandom: 1 };
    const forward = chooseFromCandidates(zeroRandom, candidates);
    const reversed = chooseFromCandidates(zeroRandom, [...candidates].reverse());
    expect(forward).toEqual(reversed);
    expect(chooseFromCandidates(oneRandom, candidates)).not.toEqual(forward);
  });

});
