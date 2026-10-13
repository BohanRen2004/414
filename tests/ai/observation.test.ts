import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { Card, PlayerId, Rank } from '../../client/assets/scripts/core/cards/card';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { XorShift32 } from '../../client/assets/scripts/core/random/prng';
import { applyAction, createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { c } from '../helpers/cards';
import { dispatch, expectSuccess } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';

function allAiGameAfter(seed: number, actions: number): GameState {
  const started = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed })).state;
  let state: GameState = {
    ...started,
    players: started.players.map((player) => ({ ...player, controlType: 'BASIC_AI' })) as unknown as GameState['players'],
  };
  for (let count = 0; count < actions; count += 1) {
    const action = chooseBasicAiAction(buildObservation(state, state.currentPlayer!));
    state = expectSuccess(applyAction(state, action)).state;
  }
  return state;
}

/** Reshuffle every card the viewer cannot see among the other seats, keeping each public hand size. */
function redealHiddenCards(state: GameState, viewer: PlayerId, shuffleSeed: number): GameState {
  const pool = state.players.filter((player) => player.playerId !== viewer).flatMap((player) => player.hand);
  const random = new XorShift32(shuffleSeed);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = random.nextInt(index + 1);
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  let offset = 0;
  const players = state.players.map((player) => {
    if (player.playerId === viewer) return player;
    const hand = pool.slice(offset, offset + player.hand.length);
    offset += player.hand.length;
    return { ...player, hand };
  }) as unknown as GameState['players'];
  return { ...state, players };
}

describe('AI observation privacy', () => {
  it('copies only the acting player hand and public data', () => {
    const hands = dealFourPlayers(414).hands;
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: { 0: hands[0]!, 1: hands[1]!, 2: hands[2]!, 3: hands[3]! },
    });
    const observation = buildObservation(state, 1);

    expect(observation.ownHand.map((card) => card.id).sort()).toEqual(state.players[1].hand.map((card) => card.id).sort());
    expect(observation.ownHand).not.toBe(state.players[1].hand);
    expect(observation.publicPlayers.map((player) => player.remaining)).toEqual([27, 27, 27, 27]);
    expect(observation.publicPlayers.map((player) => player.teamId)).toEqual([0, 1, 0, 1]);
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain(state.players[0].hand[0]!.id);
    expect(serialized).not.toContain(state.players[2].hand[0]!.id);
    expect(serialized).not.toContain('players');
    expect(observation).not.toHaveProperty('gameState');
    expect(observation).not.toHaveProperty('randomState');
  });

  it('returns detached public history and current-play snapshots', () => {
    const hands = dealFourPlayers(414).hands;
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: { 0: hands[0]!, 1: hands[1]!, 2: hands[2]!, 3: hands[3]! },
    });
    const observation = buildObservation(state, 1);
    expect(observation.currentPlay).toBeNull();
    expect(observation.publicHistory).toEqual([]);
    expect(observation.decisionRandom).toBeGreaterThanOrEqual(0);
  });

  it('stays identical when only the deal seed or other players\' cards differ', () => {
    const otherDeal = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 99 })).state;
    for (const seed of [414, 2026, 77]) {
      for (const actions of [0, 5, 12]) {
        const state = allAiGameAfter(seed, actions);
        for (const viewer of [0, 1, 2, 3] as const) {
          const hidden: GameState = {
            ...redealHiddenCards(state, viewer, seed + actions + viewer),
            rootSeed: otherDeal.rootSeed,
            randomState: otherDeal.randomState,
          };
          expect(hidden.players.map((player) => player.hand)).not.toEqual(state.players.map((player) => player.hand));
          expect(buildObservation(hidden, viewer), `seed ${seed}, ${actions} actions, seat ${viewer}`)
            .toEqual(buildObservation(state, viewer));
        }
      }
    }
  });

  it('does not reveal the dealt order of its own hand', () => {
    const state = allAiGameAfter(414, 3);
    const reordered: GameState = {
      ...state,
      players: state.players.map((player) => (
        player.playerId === 1 ? { ...player, hand: [...player.hand].reverse() } : player
      )) as unknown as GameState['players'],
    };
    expect(buildObservation(reordered, 1)).toEqual(buildObservation(state, 1));
  });

  it('keys the tie-break value on which cards were played, not the order they were picked in', () => {
    let state = allAiGameAfter(414, 0);
    for (let actions = 1; !state.publicHistory.some((record) => record.cardIds.length > 1); actions += 1) {
      state = allAiGameAfter(414, actions);
    }
    const repicked: GameState = {
      ...state,
      publicHistory: state.publicHistory.map((record) => ({ ...record, cardIds: [...record.cardIds].reverse() })),
    };
    expect(buildObservation(repicked, 0).decisionRandom).toBe(buildObservation(state, 0).decisionRandom);
  });

  it('varies one seat\'s tie-break value as the public history grows', () => {
    const values = [4, 8, 12, 16].map((actions) => buildObservation(allAiGameAfter(414, actions), 0).decisionRandom);
    expect(new Set(values).size).toBe(values.length);
  });

  describe('hidden gou-cha queries', () => {
    type PairHolder = 1 | 2 | null;

    /** Seats 1 and 2 split the same hidden cards; only which of them (if any) holds a pair of fives differs. */
    function hiddenHands(pairAt: PairHolder): Record<1 | 2, Card[]> {
      if (pairAt === 1) {
        return {
          1: [c('h-five-a', Rank.FIVE), c('h-five-b', Rank.FIVE), c('h-nine', Rank.NINE)],
          2: [c('h-six', Rank.SIX), c('h-ten', Rank.TEN), c('h-jack', Rank.JACK)],
        };
      }
      if (pairAt === 2) {
        return {
          1: [c('h-six', Rank.SIX), c('h-nine', Rank.NINE), c('h-jack', Rank.JACK)],
          2: [c('h-five-a', Rank.FIVE), c('h-five-b', Rank.FIVE), c('h-ten', Rank.TEN)],
        };
      }
      return {
        1: [c('h-five-a', Rank.FIVE), c('h-nine', Rank.NINE), c('h-jack', Rank.JACK)],
        2: [c('h-five-b', Rank.FIVE), c('h-six', Rank.SIX), c('h-ten', Rank.TEN)],
      };
    }

    /** Seat 0 leads a single five; everyone but seat 3 declines any query and passes until seat 3 must act. */
    function seatThreeTurn(pairAt: PairHolder, viewerHand: readonly Card[]): { readonly afterLead: GameState; readonly state: GameState } {
      const start = buildState({
        phase: 'FREE_LEAD',
        currentPlayer: 0,
        hands: { 0: [c('lead-five', Rank.FIVE), c('lead-king', Rank.KING)], ...hiddenHands(pairAt), 3: viewerHand },
      });
      const afterLead = dispatch(start, { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['lead-five'] });
      let state = afterLead;
      while (state.currentPlayer !== 3) {
        const playerId = state.currentPlayer!;
        state = dispatch(state, state.phase === 'GOUCHA_QUERY'
          ? { kind: 'DECLINE_GOUCHA', playerId }
          : { kind: 'PASS', playerId });
      }
      return { afterLead, state };
    }

    it('gives seat 3 the same ordinary response turn whichever hidden seat was asked and declined', () => {
      const viewerHand = [c('v-seven', Rank.SEVEN), c('v-queen', Rank.QUEEN)];
      const worlds = ([1, 2, null] as const).map((pairAt) => seatThreeTurn(pairAt, viewerHand));
      expect(worlds.map(({ afterLead }) => [afterLead.phase, afterLead.currentPlayer])).toEqual([
        ['GOUCHA_QUERY', 1],
        ['GOUCHA_QUERY', 2],
        ['RESPONDING', 1],
      ]);
      const [first, ...others] = worlds.map(({ state }) => buildObservation(state, 3));
      expect(first).toMatchObject({ phase: 'RESPONDING', isCurrentPlayer: true });
      for (const observation of others) expect(observation).toEqual(first);
    });

    it('gives seat 3 the same gou-cha prompt whether or not an earlier hidden seat declined first', () => {
      const viewerHand = [c('v-five-a', Rank.FIVE), c('v-five-b', Rank.FIVE), c('v-queen', Rank.QUEEN)];
      const worlds = ([1, 2, null] as const).map((pairAt) => seatThreeTurn(pairAt, viewerHand));
      expect(worlds.map(({ afterLead }) => afterLead.currentPlayer)).toEqual([1, 2, 3]);
      const [first, ...others] = worlds.map(({ state }) => buildObservation(state, 3));
      expect(first).toMatchObject({ phase: 'GOUCHA_QUERY', legalContext: { gouChaNeed: 'CHA', gouChaRank: Rank.FIVE } });
      for (const observation of others) expect(observation).toEqual(first);
    });
  });

  it('gives seat 3 the same GOU prompt, naming the CHA player as holder, whether or not a hidden seat declined the GOU first', () => {
    const world = (partnerHasFive: boolean): GameState => {
      let state = buildState({
        phase: 'FREE_LEAD',
        currentPlayer: 0,
        hands: {
          0: [c('lead-five', Rank.FIVE), c('lead-king', Rank.KING)],
          // The loose five sits with seat 2 (asked to GOU first) or with the CHA player (never asked).
          1: [c('cha-a', Rank.FIVE), c('cha-b', Rank.FIVE), partnerHasFive ? c('1-nine', Rank.NINE) : c('x-five', Rank.FIVE)],
          2: [partnerHasFive ? c('x-five', Rank.FIVE) : c('1-nine', Rank.NINE), c('2-ten', Rank.TEN)],
          3: [c('v-five', Rank.FIVE), c('v-queen', Rank.QUEEN)],
        },
      });
      state = dispatch(state, { kind: 'PLAY_CARDS', playerId: 0, cardIds: ['lead-five'] });
      state = dispatch(state, { kind: 'ADD_GOUCHA', playerId: 1, addition: 'CHA', cardIds: ['cha-a', 'cha-b'] });
      if (partnerHasFive) {
        expect(state.currentPlayer).toBe(2);
        state = dispatch(state, { kind: 'DECLINE_GOUCHA', playerId: 2 });
      }
      expect(state).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 3 });
      return state;
    };
    const declinedFirst = buildObservation(world(true), 3);
    expect(declinedFirst).toMatchObject({
      phase: 'GOUCHA_QUERY',
      holderId: 1,
      currentPlay: { cardIds: ['lead-five'], playerId: 0, pattern: { kind: 'SINGLE', rank: Rank.FIVE } },
      legalContext: { gouChaNeed: 'GOU', gouChaRank: Rank.FIVE },
    });
    expect(buildObservation(world(false), 3)).toEqual(declinedFirst);
  });

  it('reports an invalid runtime seat ID clearly', () => {
    const hands = dealFourPlayers(414).hands;
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 1,
      hands: { 0: hands[0]!, 1: hands[1]!, 2: hands[2]!, 3: hands[3]! },
    });
    expect(() => buildObservation(state, 4 as never)).toThrowError(
      new RangeError('playerId must be an integer seat from 0 to 3; received 4'),
    );
  });
});
