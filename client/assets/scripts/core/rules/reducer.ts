import { PlayerId } from '../cards/card';
import { dealFourPlayers } from '../cards/deck';
import { deriveSeed } from '../random/prng';
import { GameAction } from '../state/game-action';
import { GameEvent } from '../state/game-event';
import { GameState, PlayerState } from '../state/game-state';
import { RuleError, ruleError } from '../state/rule-error';
import { addGouCha, declineGouCha, maybeStartGouCha } from './goucha';
import { assertGameState } from './invariants';
import { passTurn, playCards } from './normal-trick';

export type ActionResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly error: RuleError };

const seatIds = [0, 1, 2, 3] as const satisfies readonly PlayerId[];

function createPlayer(playerId: PlayerId, hand: PlayerState['hand'] = []): PlayerState {
  return {
    playerId,
    teamId: (playerId % 2) as 0 | 1,
    controlType: playerId === 0 ? 'HUMAN' : 'BASIC_AI',
    hand,
    finishPlace: null,
    lastReportedCount: null,
  };
}

export function createSetupState(): GameState {
  return {
    rulesVersion: '1.0.0',
    phase: 'SETUP',
    rootSeed: null,
    randomState: null,
    firstPlayer: null,
    players: [createPlayer(0), createPlayer(1), createPlayer(2), createPlayer(3)],
    currentPlayer: null,
    trick: null,
    finishOrder: [],
    playedCardIds: [],
    publicHistory: [],
    actionNumber: 0,
    result: null,
  };
}

function startGame(state: GameState, seed: number): ActionResult {
  if (state.phase !== 'SETUP') return { ok: false, error: ruleError('WRONG_PHASE') };

  const deal = dealFourPlayers(seed);
  const players = seatIds.map((playerId) => createPlayer(playerId, deal.hands[playerId])) as unknown as GameState['players'];
  const started: GameState = {
    ...state,
    phase: 'FREE_LEAD',
    rootSeed: seed,
    randomState: {
      deal: deal.dealStateAfterSetup,
      ai: deriveSeed(seed, 'AI'),
    },
    firstPlayer: deal.firstPlayer,
    players,
    currentPlayer: deal.firstPlayer,
    trick: null,
    finishOrder: [],
    playedCardIds: [],
    publicHistory: [],
    actionNumber: 1,
    result: null,
  };

  return {
    ok: true,
    state: started,
    events: [
      { kind: 'GAME_STARTED' },
      { kind: 'CARDS_DEALT' },
      { kind: 'TURN_CHANGED', playerId: deal.firstPlayer },
    ],
  };
}

function applyActionUnchecked(state: GameState, action: GameAction): ActionResult {
  if (action.kind === 'START_GAME') return startGame(state, action.seed);
  if (state.phase === 'ROUND_RESULT') return { ok: false, error: ruleError('GAME_ALREADY_FINISHED') };
  if (state.phase === 'GOUCHA_QUERY') {
    if (action.kind === 'ADD_GOUCHA') return addGouCha(state, action);
    if (action.kind === 'DECLINE_GOUCHA') return declineGouCha(state, action.playerId);
    return { ok: false, error: ruleError('WRONG_PHASE') };
  }
  if (action.kind === 'PLAY_CARDS') {
    const result = playCards(state, action);
    if (!result.ok) return result;
    const base = result.state.trick?.currentPlay;
    if (result.state.phase !== 'RESPONDING' || base?.pattern.kind !== 'SINGLE') return result;

    const started = maybeStartGouCha(result.state, base);
    if (started === result.state) return result;
    const events = [...result.events];
    if (started.currentPlayer !== result.state.currentPlayer && events[events.length - 1]?.kind === 'TURN_CHANGED') {
      events.pop();
    }
    if (started.currentPlayer !== result.state.currentPlayer && started.currentPlayer !== null) {
      events.push({ kind: 'TURN_CHANGED', playerId: started.currentPlayer });
    }
    return { ok: true, state: started, events };
  }
  if (action.kind === 'PASS') return passTurn(state, action);
  return { ok: false, error: ruleError('WRONG_PHASE') };
}

let invariantAssertionsOverride: boolean | undefined;

/** Explicit opt-in for embedding runtimes and tests; no Node `process` global is required. */
export function setInvariantAssertionsEnabled(enabled: boolean): void {
  invariantAssertionsOverride = enabled;
}

function shouldAssertSuccessfulTransitions(): boolean {
  if (invariantAssertionsOverride !== undefined) return invariantAssertionsOverride;
  const runtime = globalThis as typeof globalThis & {
    __414_DEV__?: boolean;
    DEBUG?: boolean;
    CC_DEBUG?: boolean;
  };
  const nodeEnvironment = typeof process === 'undefined' ? undefined : process.env?.NODE_ENV;
  return nodeEnvironment === 'test'
    || nodeEnvironment === 'development'
    || runtime.__414_DEV__ === true
    || runtime.DEBUG === true
    || runtime.CC_DEBUG === true;
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  const result = applyActionUnchecked(state, action);
  if (result.ok && shouldAssertSuccessfulTransitions()) assertGameState(result.state);
  return result;
}
