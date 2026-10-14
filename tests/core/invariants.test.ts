import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { beats } from '../../client/assets/scripts/core/patterns/compare';
import { Rank } from '../../client/assets/scripts/core/cards/card';
import { formatDiagnosticLog } from '../../client/assets/scripts/core/diagnostics/action-log';
import { assertGameState, InvariantCode } from '../../client/assets/scripts/core/rules/invariants';
import { applyAction, createSetupState, setInvariantAssertionsEnabled } from '../../client/assets/scripts/core/rules/reducer';
import { buildResult } from '../../client/assets/scripts/core/rules/results';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameState, GouChaChain } from '../../client/assets/scripts/core/state/game-state';
import { errorCode, expectSuccess } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';
import { c } from '../helpers/cards';

const emptyHands = { 0: [], 1: [], 2: [], 3: [] } as const;

function expectInvariant(state: GameState, code: InvariantCode): void {
  expect(() => assertGameState(state)).toThrow(new RegExp(code));
}

describe('game state invariants', () => {
  beforeEach(() => setInvariantAssertionsEnabled(true));

  it('allows the empty setup state and a complete dealt fixture', () => {
    expect(() => assertGameState(createSetupState())).not.toThrow();
    const dealt = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414 }));
    expect(() => assertGameState(dealt.state)).not.toThrow();
    const oneDeck = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414, deckCount: 1 }));
    expect(() => assertGameState(oneDeck.state)).not.toThrow();
    const oneDeckFixture = buildState({
      deckCount: 1,
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: { 0: [c('a', Rank.FIVE)], 1: [c('b', Rank.SIX)], 2: [c('c', Rank.SEVEN)], 3: [c('d', Rank.EIGHT)] },
    });
    expect(oneDeckFixture.playedCardIds).toHaveLength(50);
    expect(() => assertGameState(oneDeckFixture)).not.toThrow();
  });

  it('checks card conservation against the total of the game\'s deck version', () => {
    const one = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414, deckCount: 1 })).state;
    const two = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed: 414 })).state;
    // 54 cards labelled as a two-deck game, 108 labelled as a one-deck game.
    expectInvariant({ ...one, deckCount: 2 }, 'CARD_TOTAL');
    expectInvariant({ ...two, deckCount: 1 }, 'CARD_TOTAL');
    expect(() => assertGameState({ ...one, deckCount: 2 })).toThrow(/expected 108 cards/);
    expect(() => assertGameState({ ...two, deckCount: 1 })).toThrow(/belongs to deck 2 of a 1-deck game/);
    // A started game must name a known deck version.
    expectInvariant({ ...one, deckCount: null }, 'CARD_TOTAL');
    expectInvariant({ ...two, deckCount: 3 as unknown as GameState['deckCount'] }, 'CARD_TOTAL');
    // One missing card in a one-deck game.
    const [seat0, seat1, seat2, seat3] = one.players;
    expectInvariant({ ...one, players: [{ ...seat0, hand: seat0.hand.slice(1) }, seat1, seat2, seat3] }, 'CARD_TOTAL');
    const fixture = buildState({ deckCount: 1, phase: 'FREE_LEAD', currentPlayer: 0, hands: emptyHands });
    expect(fixture.playedCardIds).toHaveLength(54);
    expectInvariant({ ...fixture, playedCardIds: fixture.playedCardIds.slice(1) }, 'CARD_TOTAL');
    // A second-deck card swapped into a one-deck game keeps the total but is still foreign.
    const foreign = two.players.flatMap((player) => player.hand).find((card) => card.deckIndex === 1)!;
    expectInvariant({ ...one, players: [{ ...seat0, hand: [foreign, ...seat0.hand.slice(1)] }, seat1, seat2, seat3] }, 'CARD_TOTAL');
    // SETUP has no version until START_GAME picks one.
    expectInvariant({ ...createSetupState(), deckCount: 1 }, 'CARD_TOTAL');
  });

  it('detects duplicate IDs before checking total card count', () => {
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: [c('in-hand', Rank.FIVE)],
        1: [c('other', Rank.SIX)],
        2: [c('third', Rank.SEVEN)],
        3: [c('fourth', Rank.EIGHT)],
      },
    });
    const corrupted: GameState = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], hand: [...state.players[1].hand, state.players[0].hand[0]!] },
        state.players[2],
        state.players[3],
      ],
    };
    expectInvariant(corrupted, 'CARD_DUPLICATED');
  });

  it('detects a missing physical card', () => {
    const state = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands: emptyHands });
    const corrupted: GameState = {
      ...state,
      playedCardIds: state.playedCardIds.slice(1),
    };
    expectInvariant(corrupted, 'CARD_TOTAL');
  });

  it('detects duplicate finish order and duplicate finish places', () => {
    const state = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands: emptyHands });
    expectInvariant({ ...state, finishOrder: [0, 0] as unknown as GameState['finishOrder'] }, 'FINISH_DUPLICATED');

    const duplicatePlaces: GameState = {
      ...state,
      finishOrder: [0, 1],
      players: [
        { ...state.players[0], finishPlace: 1 },
        { ...state.players[1], finishPlace: 1 },
        state.players[2],
        state.players[3],
      ],
    };
    expectInvariant(duplicatePlaces, 'FINISH_DUPLICATED');
  });

  it('detects an out-of-range or inactive current player', () => {
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: [c('active-0', Rank.FIVE)],
        1: [],
        2: [c('active-2', Rank.SEVEN)],
        3: [c('active-3', Rank.EIGHT)],
      },
      finishOrder: [1],
    });
    expectInvariant({ ...state, currentPlayer: 9 as unknown as GameState['currentPlayer'] }, 'CURRENT_PLAYER_INVALID');
    expectInvariant({ ...state, currentPlayer: 1 }, 'CURRENT_PLAYER_INVALID');
  });

  it('detects phase/trick mismatches', () => {
    const state = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: [c('active-card', Rank.FIVE)],
        1: [c('other-active-1', Rank.SIX)],
        2: [c('other-active-2', Rank.SEVEN)],
        3: [c('other-active-3', Rank.EIGHT)],
      },
    });
    expectInvariant({ ...state, phase: 'RESPONDING', trick: null }, 'PHASE_TRICK_MISMATCH');
  });

  it('rejects ghost current-play references and cards still held in a hand', () => {
    const state = buildState({
      phase: 'RESPONDING',
      currentPlayer: 1,
      hands: {
        0: [c('holder-card', Rank.FIVE)],
        1: [c('responder-card', Rank.SIX)],
        2: [c('other-card-2', Rank.SEVEN)],
        3: [c('other-card-3', Rank.EIGHT)],
      },
      currentPlay: {
        cardIds: ['table-five'],
        pattern: { kind: 'SINGLE', rank: Rank.FIVE },
        playerId: 0,
        actionNumber: 1,
      },
      holderId: 0,
    });
    const trick = state.trick!;
    expectInvariant({
      ...state,
      trick: { ...trick, currentPlay: { ...trick.currentPlay, cardIds: ['ghost-play'] } },
    }, 'PHASE_TRICK_MISMATCH');
    expectInvariant({
      ...state,
      trick: { ...trick, currentPlay: { ...trick.currentPlay, cardIds: ['holder-card'] } },
    }, 'PHASE_TRICK_MISMATCH');
    expectInvariant({
      ...state,
      trick: { ...trick, currentPlay: { ...trick.currentPlay, cardIds: ['table-five', 'table-five'] } },
    }, 'PHASE_TRICK_MISMATCH');
  });

  it('enforces finish-place hand rules and validates the recorded result', () => {
    const activeState = buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      hands: {
        0: [c('active-zero', Rank.FIVE)],
        1: [c('finished-one', Rank.SIX)],
        2: [c('active-two', Rank.SEVEN)],
        3: [c('active-three', Rank.EIGHT)],
      },
    });
    expectInvariant({
      ...activeState,
      finishOrder: [1],
      players: [
        activeState.players[0],
        { ...activeState.players[1], finishPlace: 1 },
        activeState.players[2],
        activeState.players[3],
      ],
    }, 'FINISH_DUPLICATED');
    expectInvariant({
      ...activeState,
      players: [
        { ...activeState.players[0], hand: [] },
        activeState.players[1],
        activeState.players[2],
        activeState.players[3],
      ],
      playedCardIds: [...activeState.playedCardIds, activeState.players[0].hand[0]!.id],
    }, 'FINISH_DUPLICATED');

    const result = buildResult([0, 1, 2, 3]);
    const completed = buildState({
      phase: 'ROUND_RESULT',
      currentPlayer: null,
      finishOrder: [0, 1, 2, 3],
      hands: {
        0: [],
        1: [],
        2: [],
        3: [c('fourth-retains', Rank.TWO)],
      },
      currentPlay: {
        cardIds: ['result-table-card'],
        pattern: { kind: 'SINGLE', rank: Rank.THREE },
        playerId: 3,
        actionNumber: 1,
      },
      holderId: 3,
      overrides: { result },
    });
    expect(() => assertGameState(completed)).not.toThrow();
    expectInvariant({ ...completed, result: { ...result, winningTeam: 1 } }, 'PHASE_TRICK_MISMATCH');

    const fourthOutsideResult = buildState({
      phase: 'ROUND_RESULT',
      currentPlayer: null,
      finishOrder: [0, 1, 2, 3],
      hands: {
        0: [],
        1: [],
        2: [],
        3: [c('fourth-too-early', Rank.TWO)],
      },
      overrides: { phase: 'FREE_LEAD' },
    });
    expectInvariant(fourthOutsideResult, 'FINISH_DUPLICATED');

    const fourthEmptyOutsideResult = buildState({
      phase: 'ROUND_RESULT',
      currentPlayer: null,
      finishOrder: [0, 1, 2, 3],
      hands: { 0: [], 1: [], 2: [], 3: [] },
      overrides: { phase: 'TRICK_RESET' },
    });
    expectInvariant(fourthEmptyOutsideResult, 'FINISH_DUPLICATED');
  });

  it('rejects fixtures with cards in a finished top-three hand without mutating input', () => {
    const hands = {
      0: [c('fixture-seat-0', Rank.FIVE)],
      1: [c('finished-but-holding', Rank.SIX)],
      2: [c('fixture-seat-2', Rank.SEVEN)],
      3: [c('fixture-seat-3', Rank.EIGHT)],
    } as const;
    const originalHands = structuredClone(hands);
    expect(() => buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands, finishOrder: [1] }))
      .toThrow(/finish place 1.*must have an empty hand/);
    expect(hands).toEqual(originalHands);
    expect(() => buildState({
      phase: 'FREE_LEAD',
      currentPlayer: 0,
      finishOrder: [0, 1, 2, 3],
      hands: {
        0: [],
        1: [],
        2: [],
        3: [c('fourth-retained-too-early', Rank.TWO)],
      },
    })).toThrow(/fourth-place player 3 may retain cards only in ROUND_RESULT/);
  });

  it('accepts CHA and GOU queries whose current play stays the base single', () => {
    const basePlay = {
      cardIds: ['base-five'],
      pattern: { kind: 'SINGLE' as const, rank: Rank.FIVE },
      playerId: 0 as const,
      actionNumber: 1,
    };
    const beforeCha: GouChaChain = {
      rank: Rank.FIVE,
      basePlay,
      additions: [],
      holderId: 0,
      nextAddition: 'CHA',
      queryCursor: 1,
      declinedPlayerIds: [],
    };
    const chaQuery = buildState({
      phase: 'GOUCHA_QUERY',
      currentPlayer: 1,
      hands: {
        0: [c('holder-extra', Rank.NINE)],
        1: [c('cha-a', Rank.FIVE), c('cha-b', Rank.FIVE)],
        2: [c('gou-later', Rank.FIVE)],
        3: [c('other', Rank.TEN)],
      },
      gouCha: beforeCha,
    });
    expect(() => assertGameState(chaQuery)).not.toThrow();

    const ghostChain = {
      ...chaQuery.trick!.gouCha!,
      basePlay: { ...chaQuery.trick!.gouCha!.basePlay, cardIds: ['ghost-base'] },
    };
    expectInvariant({
      ...chaQuery,
      trick: {
        ...chaQuery.trick!,
        currentPlay: { ...chaQuery.trick!.currentPlay, cardIds: ['ghost-base'] },
        gouCha: ghostChain,
      },
    }, 'PHASE_TRICK_MISMATCH');

    const afterCha: GouChaChain = {
      ...beforeCha,
      additions: [{ addition: 'CHA', playerId: 1, cardIds: ['cha-a', 'cha-b'], actionNumber: 2 }],
      holderId: 1,
      nextAddition: 'GOU',
      queryCursor: 2,
    };
    const gouQuery = buildState({
      phase: 'GOUCHA_QUERY',
      currentPlayer: 2,
      hands: {
        0: [c('holder-extra-0', Rank.NINE)],
        1: [c('holder-extra-1', Rank.NINE)],
        2: [c('gou-five', Rank.FIVE)],
        3: [c('other', Rank.TEN)],
      },
      gouCha: afterCha,
    });
    expect(gouQuery.trick).toMatchObject({ currentPlay: basePlay, holderId: 1 });
    expect(() => assertGameState(gouQuery)).not.toThrow();

    const gouTrick = gouQuery.trick!;
    const gouChain = gouTrick.gouCha!;
    // The CHA cards are an action, not a pattern: a current play merged into a three-card bomb is corrupt.
    expectInvariant({
      ...gouQuery,
      trick: {
        ...gouTrick,
        currentPlay: {
          cardIds: ['base-five', 'cha-a', 'cha-b'],
          pattern: { kind: 'N_OF_KIND_BOMB', rank: Rank.FIVE, count: 3 },
          playerId: 1,
          actionNumber: 2,
        },
      },
    }, 'PHASE_TRICK_MISMATCH');
    expectInvariant({
      ...gouQuery,
      trick: { ...gouTrick, holderId: 0, gouCha: { ...gouChain, holderId: 0 } },
    }, 'PHASE_TRICK_MISMATCH');
    expectInvariant({
      ...gouQuery,
      trick: { ...gouTrick, gouCha: { ...gouChain, nextAddition: 'CHA' } },
    }, 'PHASE_TRICK_MISMATCH');
    expectInvariant({
      ...gouQuery,
      trick: {
        ...gouTrick,
        gouCha: { ...gouChain, additions: [{ ...gouChain.additions[0]!, cardIds: ['cha-a', 'cha-a'] }] },
      },
    }, 'PHASE_TRICK_MISMATCH');
    expectInvariant({
      ...gouQuery,
      trick: {
        ...gouTrick,
        gouCha: { ...gouChain, additions: [{ ...gouChain.additions[0]!, cardIds: ['cha-a', 'base-five'] }] },
      },
    }, 'PHASE_TRICK_MISMATCH');
    // Nobody may CHA their own single.
    expectInvariant({
      ...gouQuery,
      trick: {
        ...gouTrick,
        holderId: 0,
        gouCha: { ...gouChain, holderId: 0, additions: [{ ...gouChain.additions[0]!, playerId: 0 }] },
      },
    }, 'PHASE_TRICK_MISMATCH');
  });

  it('checks short seeded legal sequences and rejected-action immutability in both deck versions', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0x7fff_ffff }), fc.constantFrom(1 as const, 2 as const), (seed, deckCount) => {
      const totalCards = deckCount * 54;
      let state = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed, deckCount })).state;
      const rejectedSnapshot = structuredClone(state);
      const rejected = applyAction(state, {
        kind: 'PLAY_CARDS',
        playerId: state.currentPlayer!,
        cardIds: ['missing-card'],
      });
      expect(errorCode(rejected)).not.toBeNull();
      expect(state).toEqual(rejectedSnapshot);

      for (let step = 0; step < 6 && state.phase !== 'ROUND_RESULT'; step += 1) {
        const beforeHandCounts = state.players.map((player) => player.hand.length);
        let action: GameAction;
        if (state.phase === 'FREE_LEAD') {
          const playerId = state.currentPlayer!;
          action = { kind: 'PLAY_CARDS' as const, playerId, cardIds: [state.players[playerId].hand[0]!.id] };
        } else if (state.phase === 'GOUCHA_QUERY') {
          action = { kind: 'DECLINE_GOUCHA' as const, playerId: state.currentPlayer! };
        } else {
          action = { kind: 'PASS' as const, playerId: state.currentPlayer! };
        }
        const result = applyAction(state, action);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
        expect(() => assertGameState(state)).not.toThrow();
        const allIds = [...state.players.flatMap((player) => player.hand.map((card) => card.id)), ...state.playedCardIds];
        expect(allIds).toHaveLength(totalCards);
        expect(new Set(allIds).size).toBe(totalCards);
        const handPositions = state.players.flatMap((player) => player.hand.map((card) =>
          `${card.deckIndex}:${card.suit}:${card.rank}`,
        ));
        expect(new Set(handPositions).size).toBe(handPositions.length);
        expect(state.players.map((player) => player.hand.length).every((count, index) => count <= beforeHandCounts[index]!)).toBe(true);
        expect(new Set(state.finishOrder).size).toBe(state.finishOrder.length);
        expect(new Set(state.players.flatMap((player) => player.finishPlace === null ? [] : [player.finishPlace])).size)
          .toBe(state.finishOrder.length);
      }
    }), { numRuns: 120 });

    fc.assert(fc.property(
      fc.constantFrom(Rank.THREE, Rank.FIVE, Rank.ACE, Rank.SMALL_JOKER, Rank.BIG_JOKER),
      (rank) => {
        expect(beats({ kind: 'SINGLE', rank }, { kind: 'SINGLE', rank })).toBe(false);
      },
    ));
  });

  it('formats stable local JSON Lines with sorted details and seed context', () => {
    const log = formatDiagnosticLog([{
      level: 'ERROR',
      seed: 414,
      rulesVersion: '1.1.0',
      deckCount: 1,
      actionNumber: 7,
      phase: 'GOUCHA_QUERY',
      playerId: 2,
      code: 'PHASE_TRICK_MISMATCH',
      details: { zeta: true, alpha: 'gou-cha' },
    }]);
    expect(log).toBe('{"seed":414,"rulesVersion":"1.1.0","deckCount":1,"actionNumber":7,"phase":"GOUCHA_QUERY","playerId":2,"code":"PHASE_TRICK_MISMATCH","details":{"alpha":"gou-cha","zeta":true},"level":"ERROR"}');
    expect(formatDiagnosticLog([])).toBe('');
  });
});
