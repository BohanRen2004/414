import { beforeEach, describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { applyAction, createSetupState, setInvariantAssertionsEnabled } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { XorShift32 } from '../../client/assets/scripts/core/random/prng';
import { expectSuccess } from '../helpers/actions';
import { AnimationSink } from '../../client/assets/scripts/app/animation-queue';
import { GameController } from '../../client/assets/scripts/app/game-controller';
import { runHeadlessMatch } from '../../client/assets/scripts/app/headless-match';

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
    const secondResult = await controller.dispatch(nextAction(latestState));
    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) expect(secondResult.state).toBe(controller.state);
    expect(controller.state.actionNumber).toBe(initial.actionNumber + 2);
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

  it('advances the AI random stream exactly once after one accepted AI action', async () => {
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
    const expectedRandom = new XorShift32(state.randomState!.ai).nextUint32();
    const action = chooseBasicAiAction(buildObservation(state, actingPlayer));
    const sink: AnimationSink = { play: async () => undefined, snapTo: () => undefined };
    const controller = new GameController(state, sink);
    const result = await controller.dispatch(action);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actionResult.state.randomState?.ai).toBe(expectedRandom);
    if (result.ok) expect(result.state).toBe(controller.state);
    expect(controller.state.currentPlayer).not.toBe(actingPlayer);
  });

  it('returns the final state and exact AI follow-up count after a human dispatch', async () => {
    const dealt = startState(418);
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

  it('does not advance AI randomness when the reducer rejects the AI action', async () => {
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
    const initialAiRandom = state.randomState!.ai;
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
    expect(controller.state.randomState?.ai).toBe(initialAiRandom);
  });

  it('throws with seed, cap, and diagnostics instead of returning an unfinished match', async () => {
    await expect(runHeadlessMatch(414, 0)).rejects.toThrow(
      /seed=414; actionCount=0; rejectedActions=0; diagnosticLog=/,
    );
  });

  it('finishes 100 seeded all-AI matches with unique places and deterministic seed-414 output', async () => {
    let seed414: Awaited<ReturnType<typeof runHeadlessMatch>> | undefined;
    for (let offset = 0; offset < 100; offset += 1) {
      const seed = (414 + offset * 9_973) >>> 0;
      const match = await runHeadlessMatch(seed, 20_000);
      expect(match.finalState.phase).toBe('ROUND_RESULT');
      expect(match.actionCount).toBeLessThan(20_000);
      expect(match.rejectedActions).toBe(0);
      expect(match.finalState.finishOrder).toHaveLength(4);
      expect(new Set(match.finalState.finishOrder).size).toBe(4);
      expect(new Set(match.finalState.players.map((player) => player.finishPlace)).size).toBe(4);
      expect(match.finalState.publicHistory).toHaveLength(match.actionCount);
      expect(match.diagnosticLog.split('\n')).toHaveLength(match.actionCount);
      if (seed === 414) seed414 = match;
    }

    const seed414Replay = await runHeadlessMatch(414, 20_000);
    expect(seed414).toBeDefined();
    expect(seed414Replay.finalState.result).toEqual(seed414!.finalState.result);
    expect(seed414Replay.diagnosticLog).toBe(seed414!.diagnosticLog);
  });
});
