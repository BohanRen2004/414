import { buildObservation } from '../ai/ai-observation';
import { chooseBasicAiAction } from '../ai/basic-ai';
import { GameAction } from '../core/state/game-action';
import { GamePhase, GameState } from '../core/state/game-state';
import { ActionResult, applyAction } from '../core/rules/reducer';
import { RuleError } from '../core/state/rule-error';
import { DiagnosticEntry, formatDiagnosticLog } from '../core/diagnostics/action-log';
import { AnimationSink } from './animation-queue';

const MAX_ACCEPTED_ACTIONS = 20_000;

export interface ControllerBusyError {
  readonly code: 'CONTROLLER_BUSY';
  readonly messageKey: 'controller.busy';
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export type ControllerDispatchResult =
  | {
      readonly ok: true;
      /** Result of the explicitly dispatched action, before any AI follow-up actions. */
      readonly actionResult: Extract<ActionResult, { readonly ok: true }>;
      /** Authoritative state after the dispatch and any automatically pumped AI turns. */
      readonly state: GameState;
      readonly pumpedActionCount: number;
    }
  | { readonly ok: false; readonly error: RuleError | ControllerBusyError };

function controllerBusyError(): ControllerBusyError {
  return { code: 'CONTROLLER_BUSY', messageKey: 'controller.busy', context: {} };
}

function actionPlayerId(action: GameAction): number | undefined {
  return action.kind === 'START_GAME' ? undefined : action.playerId;
}

function isAiPhase(phase: GamePhase): boolean {
  return phase === 'FREE_LEAD' || phase === 'RESPONDING' || phase === 'GOUCHA_QUERY';
}

export class GameController {
  private currentState: GameState;
  private busy = false;
  private acceptedActions = 0;
  private rejectedActions = 0;
  private readonly diagnostics: DiagnosticEntry[] = [];

  public constructor(initial: GameState, private readonly animations: AnimationSink) {
    this.currentState = initial;
  }

  public get state(): GameState {
    return this.currentState;
  }

  public get actionCount(): number {
    return this.acceptedActions;
  }

  public get rejectedActionCount(): number {
    return this.rejectedActions;
  }

  public get diagnosticLog(): string {
    return formatDiagnosticLog(this.diagnostics);
  }

  public async dispatch(action: GameAction): Promise<ControllerDispatchResult> {
    if (this.busy) return { ok: false, error: controllerBusyError() };
    this.busy = true;
    try {
      const result = await this.applyAndPresent(action);
      if (!result.ok) return result;
      const acceptedBeforePump = this.acceptedActions;
      await this.pumpAiTurns(MAX_ACCEPTED_ACTIONS);
      return {
        ok: true,
        actionResult: result,
        state: this.currentState,
        pumpedActionCount: this.acceptedActions - acceptedBeforePump,
      };
    } finally {
      this.busy = false;
    }
  }

  /** Pump consecutive AI seats until a human seat, result, rejection, or action cap. */
  public async advanceAiTurns(maxActions = MAX_ACCEPTED_ACTIONS): Promise<void> {
    if (this.busy) return;
    if (!Number.isSafeInteger(maxActions) || maxActions < 0) {
      throw new RangeError('maxActions must be a nonnegative safe integer');
    }
    this.busy = true;
    try {
      await this.pumpAiTurns(maxActions);
    } finally {
      this.busy = false;
    }
  }

  private async pumpAiTurns(actionLimit: number): Promise<void> {
    while (this.acceptedActions < actionLimit && isAiPhase(this.currentState.phase)) {
      const playerId = this.currentState.currentPlayer;
      if (playerId === null || this.currentState.players[playerId].controlType !== 'BASIC_AI') return;

      const observation = buildObservation(this.currentState, playerId);
      const action = this.chooseAiAction(observation);
      const result = await this.applyAndPresent(action);
      if (!result.ok) return;
    }
  }

  protected chooseAiAction(observation: ReturnType<typeof buildObservation>): GameAction {
    return chooseBasicAiAction(observation);
  }

  private async applyAndPresent(action: GameAction): Promise<ActionResult> {
    const before = this.currentState;
    const result = applyAction(before, action);
    const playerId = actionPlayerId(action);
    const details: Record<string, string | number | boolean> = { actionKind: action.kind };
    if ('cardIds' in action) details.cardIds = action.cardIds.join(',');
    if (action.kind === 'ADD_GOUCHA') details.addition = action.addition;
    if (action.kind === 'START_GAME') details.seed = action.seed;

    const entry: DiagnosticEntry = {
      level: result.ok ? 'INFO' : 'WARN',
      seed: action.kind === 'START_GAME' ? action.seed : before.rootSeed,
      rulesVersion: before.rulesVersion,
      actionNumber: before.actionNumber,
      phase: before.phase,
      ...(playerId === undefined ? {} : { playerId: playerId as 0 | 1 | 2 | 3 }),
      code: result.ok ? 'ACTION_APPLIED' : result.error.code,
      details,
    };
    this.diagnostics.push(entry);

    if (!result.ok) {
      this.rejectedActions += 1;
      return result;
    }

    this.currentState = result.state;
    this.acceptedActions += 1;
    try {
      await this.animations.play(result.events, this.currentState);
    } catch {
      // Rules state is already committed; restore the presentation once without replaying the action.
      try {
        this.animations.snapTo(this.currentState);
      } catch {
        // A renderer failure cannot roll back the authoritative game state.
      }
    }
    return result;
  }
}
