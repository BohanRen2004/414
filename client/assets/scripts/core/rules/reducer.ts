import { PlayerId } from '../cards/card';
import { dealFourPlayers } from '../cards/deck';
import { deriveSeed } from '../random/prng';
import { GameAction } from '../state/game-action';
import { GameEvent } from '../state/game-event';
import { GameState, PlayerState } from '../state/game-state';
import { RuleError, ruleError } from '../state/rule-error';
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

export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (action.kind === 'START_GAME') return startGame(state, action.seed);
  if (state.phase === 'ROUND_RESULT') return { ok: false, error: ruleError('GAME_ALREADY_FINISHED') };
  if (action.kind === 'PLAY_CARDS') return playCards(state, action);
  if (action.kind === 'PASS') return passTurn(state, action);
  return { ok: false, error: ruleError('WRONG_PHASE') };
}
