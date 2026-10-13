import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { applyAction, createSetupState, setInvariantAssertionsEnabled } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { expectSuccess } from '../helpers/actions';
import { AnimationQueue, AnimationSink, EventRenderer } from '../../client/assets/scripts/app/animation-queue';
import { GameController } from '../../client/assets/scripts/app/game-controller';
import { runHeadlessMatch } from '../../client/assets/scripts/app/headless-match';
import { Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { firstPlayerCandidates } from '../../client/assets/scripts/core/rules/first-player';

function startState(seed: number, controlType: 'HUMAN' | 'BASIC_AI' = 'HUMAN'): GameState {
  const started = expectSuccess(applyAction(createSetupState(), { kind: 'START_GAME', seed })).state;
  const [seat0, seat1, seat2, seat3] = started.players;
  return {
    ...started,
    players: [
      { ...seat0, controlType },
      { ...seat1, controlType },
      { ...seat2, controlType },
      { ...seat3, controlType },
    ],
  };
}

function nextAction(state: GameState): GameAction {
  const playerId = state.currentPlayer;
  if (playerId === null) throw new Error(`No current player in ${state.phase}`);
  if (state.phase === 'FREE_LEAD') {
    const card = state.players[playerId].hand[0];
    if (card === undefined) throw new Error(`Player ${playerId} has no lead card`);
    return { kind: 'PLAY_CARDS', playerId, cardIds: [card.id] };
  }
  if (state.phase === 'GOUCHA_QUERY') return { kind: 'DECLINE_GOUCHA', playerId };
  if (state.phase === 'RESPONDING') return { kind: 'PASS', playerId };
  throw new Error(`Cannot act in ${state.phase}`);
}

describe('serialized controller and headless match', () => {
  beforeEach(() => setInvariantAssertionsEnabled(true));

  it('rejects concurrent dispatch and applies the next action to the latest state', async () => {
    const initial = startState(414);
    let releaseFirst: (() => void) | undefined;
    let playCalls = 0;
    const sink: AnimationSink = {
      play: async () => {
        playCalls += 1;
        if (playCalls === 1) await new Promise<void>((resolve) => { releaseFirst = () => resolve(); });
      },
      snapTo: () => undefined,
    };
    const controller = new GameController(initial, sink);
    const firstAction = nextAction(initial);
    const firstPending = controller.dispatch(firstAction);

    expect(playCalls).toBe(1);
    const busyResult = await controller.dispatch(firstAction);
    expect(busyResult).toMatchObject({ ok: false, error: { code: 'CONTROLLER_BUSY' } });
    expect(controller.actionCount).toBe(1);
    releaseFirst?.();

    const firstResult = await firstPending;
    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) {
      expect(firstResult.state).toBe(controller.state);
      expect(firstResult.actionResult.state.actionNumber).toBe(initial.actionNumber + 1);
      expect(firstResult.pumpedActionCount).toBe(0);
    }
    const latestState = controller.state;
    expect(latestState.actionNumber).toBe(initial.actionNumber + 1);
    const secondAction = nextAction(latestState);
    const secondResult = await controller.dispatch(secondAction);
    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) expect(secondResult.state).toBe(controller.state);
    expect(controller.state).toEqual(expectSuccess(applyAction(latestState, secondAction)).state);
    expect(controller.actionCount).toBe(2);
  });

  it('snaps once after animation rejection without replaying the committed rule action', async () => {
    const initial = startState(415);
    const actingPlayer = initial.currentPlayer!;
    let playCalls = 0;
    const snapped: GameState[] = [];
    const sink: AnimationSink = {
      play: async () => {
        playCalls += 1;
        throw new Error('mock animation failure');
      },
      snapTo: (state) => { snapped.push(state); },
    };
    const controller = new GameController(initial, sink);
    const result = await controller.dispatch(nextAction(initial));

    expect(result.ok).toBe(true);
    expect(playCalls).toBe(1);
    expect(snapped).toHaveLength(1);
    expect(snapped[0]).toBe(controller.state);
    expect(controller.actionCount).toBe(1);
    expect(controller.state.players[actingPlayer].hand).toHaveLength(initial.players[actingPlayer].hand.length - 1);
  });

  it('plays queued events in order', async () => {
    const state = startState(419);
    const played: string[] = [];
    const renderer: EventRenderer = {
      playEvent: async (event) => { played.push(event.kind); },
      renderState: () => undefined,
    };
    const queue = new AnimationQueue(renderer, { timeoutMs: 100 });
    const events = [
      { kind: 'GAME_STARTED' as const },
      { kind: 'TURN_CHANGED' as const, playerId: 2 as const },
      { kind: 'PLAYER_PASSED' as const, playerId: 1 as const },
    ];

    await queue.play(events, state);

    expect(played).toEqual(['GAME_STARTED', 'TURN_CHANGED', 'PLAYER_PASSED']);
  });

  it('snaps once after an animation timeout while preserving committed state and one action', async () => {
    vi.useFakeTimers();
    try {
      const initial = startState(420);
      const actingPlayer = initial.currentPlayer!;
      let playCalls = 0;
      const snapped: GameState[] = [];
      const renderer: EventRenderer = {
        playEvent: () => {
          playCalls += 1;
          return new Promise<void>(() => undefined);
        },
        renderState: (state) => { snapped.push(state); },
      };
      const controller = new GameController(initial, new AnimationQueue(renderer, { timeoutMs: 25 }));
      const action = nextAction(initial);
      const pending = controller.dispatch(action);
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(result.ok).toBe(true);
      expect(playCalls).toBe(1);
      expect(snapped).toHaveLength(1);
      expect(snapped[0]).toBe(controller.state);
      expect(controller.actionCount).toBe(1);
      expect(controller.state.actionNumber).toBe(initial.actionNumber + 1);
      expect(controller.state.players[actingPlayer].hand).toHaveLength(initial.players[actingPlayer].hand.length - 1);

      const [line] = controller.diagnosticLog.split('\n');
      expect(JSON.parse(line!)).toMatchObject({
        rulesVersion: initial.rulesVersion,
        seed: initial.rootSeed,
        actionNumber: initial.actionNumber,
        phase: initial.phase,
        playerId: actingPlayer,
        code: 'ACTION_APPLIED',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the deal random state untouched after an accepted AI action', async () => {
    const dealt = startState(416);
    const actingPlayer = dealt.currentPlayer!;
    const [seat0, seat1, seat2, seat3] = dealt.players;
    const state: GameState = {
      ...dealt,
      players: [
        { ...seat0, controlType: seat0.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat1, controlType: seat1.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat2, controlType: seat2.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat3, controlType: seat3.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
      ],
    };
    const action = chooseBasicAiAction(buildObservation(state, actingPlayer));
    const sink: AnimationSink = { play: async () => undefined, snapTo: () => undefined };
    const controller = new GameController(state, sink);
    const result = await controller.dispatch(action);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actionResult.state.randomState).toEqual(state.randomState);
    if (result.ok) expect(result.state).toBe(controller.state);
    expect(controller.state.currentPlayer).not.toBe(actingPlayer);
  });

  it('returns the final state and exact AI follow-up count after a human dispatch', async () => {
    // The follow-up must be a public response: a lead that opens a gou-cha query makes it a private
    // decline, which takes no action number. Seed 418 now opens one, since the threes decide who leads.
    const leadOpensResponse = (seed: number): boolean => {
      const state = startState(seed);
      return expectSuccess(applyAction(state, nextAction(state))).state.phase === 'RESPONDING';
    };
    let seed = 418;
    while (!leadOpensResponse(seed)) seed += 1;
    const dealt = startState(seed);
    const actingPlayer = dealt.currentPlayer!;
    const submittedAction = nextAction(dealt);
    const submittedTransition = expectSuccess(applyAction(dealt, submittedAction)).state;
    const followUpPlayer = submittedTransition.currentPlayer!;
    const [seat0, seat1, seat2, seat3] = dealt.players;
    const state: GameState = {
      ...dealt,
      players: [
        { ...seat0, controlType: seat0.playerId === followUpPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat1, controlType: seat1.playerId === followUpPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat2, controlType: seat2.playerId === followUpPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat3, controlType: seat3.playerId === followUpPlayer ? 'BASIC_AI' : 'HUMAN' },
      ],
    };
    const sink: AnimationSink = { play: async () => undefined, snapTo: () => undefined };
    const controller = new GameController(state, sink);

    const result = await controller.dispatch(submittedAction);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actionResult.state.actionNumber).toBe(state.actionNumber + 1);
      expect(result.actionResult.state.currentPlayer).toBe(followUpPlayer);
      expect(result.pumpedActionCount).toBe(1);
      expect(result.state).toBe(controller.state);
      expect(result.state.actionNumber).toBe(state.actionNumber + 2);
    }
    expect(controller.actionCount).toBe(2);
    expect(controller.state.currentPlayer).not.toBe(actingPlayer);
  });

  it('keeps the random state when the reducer rejects the AI action', async () => {
    const dealt = startState(417);
    const actingPlayer = dealt.currentPlayer!;
    const [seat0, seat1, seat2, seat3] = dealt.players;
    const state: GameState = {
      ...dealt,
      players: [
        { ...seat0, controlType: seat0.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat1, controlType: seat1.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat2, controlType: seat2.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
        { ...seat3, controlType: seat3.playerId === actingPlayer ? 'BASIC_AI' : 'HUMAN' },
      ],
    };
    const initialRandomState = state.randomState;
    const sink: AnimationSink = { play: async () => undefined, snapTo: () => undefined };
    class RejectingAiController extends GameController {
      protected override chooseAiAction(): GameAction {
        return { kind: 'PASS', playerId: actingPlayer };
      }
    }
    const controller = new RejectingAiController(state, sink);

    await controller.advanceAiTurns();

    expect(controller.rejectedActionCount).toBe(1);
    expect(controller.actionCount).toBe(0);
    expect(controller.state.randomState).toEqual(initialRandomState);
  });

  it('throws with seed, cap, and diagnostics instead of returning an unfinished match', async () => {
    await expect(runHeadlessMatch(414, 0)).rejects.toThrow(
      /seed=414; actionCount=0; rejectedActions=0; diagnosticLog=/,
    );
    await expect(runHeadlessMatch(414, 0)).rejects.toThrow(/deckCount=2; seed=414;/);
    await expect(runHeadlessMatch(414, 0, 1)).rejects.toThrow(/deckCount=1; seed=414;/);
  });

  it('finishes 100 seeded all-AI one-deck matches led by the heart-three holder, deterministically', async () => {
    let seed414: Awaited<ReturnType<typeof runHeadlessMatch>> | undefined;
    let totalGouCha = 0;
    for (let offset = 0; offset < 100; offset += 1) {
      const seed = (414 + offset * 9_973) >>> 0;
      const match = await runHeadlessMatch(seed, 20_000, 1);
      const state = match.finalState;
      expect(state.deckCount).toBe(1);
      expect(state.phase).toBe('ROUND_RESULT');
      expect(match.rejectedActions).toBe(0);
      expect(state.finishOrder).toHaveLength(4);
      expect(new Set(state.finishOrder).size).toBe(4);
      const allIds = [...state.players.flatMap((player) => player.hand.map((card) => card.id)), ...state.playedCardIds];
      expect(allIds).toHaveLength(54);
      expect(new Set(allIds).size).toBe(54);

      const deal = dealFourPlayers(seed, 1);
      const heartThree = deal.hands.findIndex((hand) => hand.some((card) => card.rank === Rank.THREE && card.suit === Suit.HEART));
      expect(state.firstPlayer).toBe(heartThree);
      expect(state.publicHistory[0]?.playerId).toBe(heartThree);

      const logLines = match.diagnosticLog.split('\n').map((line) => JSON.parse(line));
      expect(logLines).toHaveLength(match.actionCount);
      expect(logLines.every((line) => line.deckCount === 1 && line.seed === seed)).toBe(true);
      const privateDeclines = logLines.filter((line) => line.details.actionKind === 'DECLINE_GOUCHA').length;
      expect(state.publicHistory).toHaveLength(match.actionCount - privateDeclines);
      // With four cards per rank a chain never grows past single + CHA + GOU. A chain's additions are
      // consecutive public records (declines are private), and a dead chain is followed by a new lead.
      let run = 0;
      for (const record of state.publicHistory) {
        run = record.kind === 'CHA' || record.kind === 'GOU' ? run + 1 : 0;
        totalGouCha += Number(run > 0);
        expect(run, `seed ${seed}, action ${record.actionNumber}`).toBeLessThanOrEqual(2);
      }
      if (seed === 414) seed414 = match;
    }

    expect(totalGouCha).toBeGreaterThan(0);

    const replay = await runHeadlessMatch(414, 20_000, 1);
    expect(seed414).toBeDefined();
    expect(replay.finalState).toEqual(seed414!.finalState);
    expect(replay.diagnosticLog).toBe(seed414!.diagnosticLog);
    // Same seed, other version: a different game.
    const twoDecks = await runHeadlessMatch(414, 20_000, 2);
    expect(twoDecks.finalState.deckCount).toBe(2);
    expect(twoDecks.diagnosticLog).not.toBe(replay.diagnosticLog);
  });

  it('finishes 100 seeded all-AI matches with unique places and deterministic seed-414 output', async () => {
    let seed414: Awaited<ReturnType<typeof runHeadlessMatch>> | undefined;
    let totalPrivateDeclines = 0;
    for (let offset = 0; offset < 100; offset += 1) {
      const seed = (414 + offset * 9_973) >>> 0;
      const match = await runHeadlessMatch(seed, 20_000);
      expect(match.finalState.phase).toBe('ROUND_RESULT');
      expect(match.actionCount).toBeLessThan(20_000);
      expect(match.rejectedActions).toBe(0);
      expect(match.finalState.finishOrder).toHaveLength(4);
      expect(new Set(match.finalState.finishOrder).size).toBe(4);
      expect(new Set(match.finalState.players.map((player) => player.finishPlace)).size).toBe(4);
      const logLines = match.diagnosticLog.split('\n');
      expect(logLines).toHaveLength(match.actionCount);
      const privateDeclines = logLines.filter((line) => JSON.parse(line).details.actionKind === 'DECLINE_GOUCHA').length;
      totalPrivateDeclines += privateDeclines;
      expect(match.finalState.publicHistory).toHaveLength(match.actionCount - privateDeclines);
      expect(match.finalState.publicHistory.map((record) => record.actionNumber))
        .toEqual(match.finalState.publicHistory.map((_record, index) => index + 1));
      expect(match.finalState.actionNumber).toBe(match.finalState.publicHistory.length + 1);
      expect(match.finalState.deckCount).toBe(2);
      expect(firstPlayerCandidates(dealFourPlayers(seed).hands)).toContain(match.finalState.publicHistory[0]?.playerId);
      if (seed === 414) seed414 = match;
    }

    expect(totalPrivateDeclines).toBeGreaterThan(0);

    const seed414Replay = await runHeadlessMatch(414, 20_000);
    expect(seed414).toBeDefined();
    expect(seed414Replay.finalState.result).toEqual(seed414!.finalState.result);
    expect(seed414Replay.diagnosticLog).toBe(seed414!.diagnosticLog);
  });
});
