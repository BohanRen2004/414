import { generateCandidates } from '../../client/assets/scripts/ai/candidates';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { AnimationSink } from '../../client/assets/scripts/app/animation-queue';
import { GameController } from '../../client/assets/scripts/app/game-controller';
import { GameEvent } from '../../client/assets/scripts/core/state/game-event';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { buildDeclineAction, buildGouChaAction } from '../../client/assets/scripts/ui/goucha-actions';
import { clearSelection, nextHint, toggleCard } from '../../client/assets/scripts/ui/hand-selection';
import { HumanUiState, TableViewModel, buildTableViewModel } from '../../client/assets/scripts/ui/table-view-model';

export interface BrowserGameOptions {
  readonly animationDelayMs?: number;
}

export interface BrowserSessionSnapshot {
  readonly state: GameState;
  readonly viewModel: TableViewModel;
  readonly selectedCardIds: readonly string[];
  readonly events: readonly GameEvent[];
  readonly isBusy: boolean;
  readonly errorCode: string | null;
}

export type BrowserSessionListener = (snapshot: BrowserSessionSnapshot) => void;

function wait(durationMs: number): Promise<void> {
  return durationMs <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, durationMs));
}

/** Browser adapter. It owns only transient selection/presentation state; rules remain in GameController. */
export class BrowserGameSession {
  private readonly controller: GameController;
  private readonly listeners = new Set<BrowserSessionListener>();
  private readonly animationDelayMs: number;
  private ui: HumanUiState = { humanPlayerId: 0, selectedCardIds: [], hintIndex: 0 };
  private busy = false;
  private errorCode: string | null = null;

  public constructor(public readonly seed: number, options: BrowserGameOptions = {}) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError('seed must be an unsigned 32-bit integer');
    }
    this.animationDelayMs = options.animationDelayMs ?? 130;
    if (!Number.isFinite(this.animationDelayMs) || this.animationDelayMs < 0) {
      throw new RangeError('animationDelayMs must be a nonnegative finite number');
    }

    const sink: AnimationSink = {
      play: async (events, state) => {
        this.publish(events, state);
        await wait(this.animationDelayMs);
      },
      snapTo: (state) => this.publish([], state),
    };
    this.controller = new GameController(createSetupState(), sink);
  }

  public get state(): GameState {
    return this.controller.state;
  }

  public get viewModel(): TableViewModel {
    return buildTableViewModel(this.state, this.ui);
  }

  public get isBusy(): boolean {
    return this.busy;
  }

  public get selectedCardIds(): readonly string[] {
    return [...this.ui.selectedCardIds];
  }

  public get lastErrorCode(): string | null {
    return this.errorCode;
  }

  public snapshot(events: readonly GameEvent[] = []): BrowserSessionSnapshot {
    return {
      state: this.state,
      viewModel: this.viewModel,
      selectedCardIds: [...this.ui.selectedCardIds],
      events: [...events],
      isBusy: this.busy,
      errorCode: this.errorCode,
    };
  }

  public subscribe(listener: BrowserSessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  public async start(): Promise<boolean> {
    return this.dispatch({ kind: 'START_GAME', seed: this.seed });
  }

  public toggleCard(cardId: string): void {
    this.ui = toggleCard(this.ui, cardId, this.state.players[0].hand);
    this.errorCode = null;
    this.publish();
  }

  public clearSelection(): void {
    this.ui = clearSelection(this.ui);
    this.errorCode = null;
    this.publish();
  }

  public cycleHint(): void {
    const observation = buildObservation(this.state, 0);
    this.ui = nextHint(this.ui, generateCandidates(observation));
    this.errorCode = null;
    this.publish();
  }

  public async playSelection(): Promise<boolean> {
    const vm = this.viewModel;
    if (!vm.controls.playEnabled) return false;
    return this.dispatch({
      kind: 'PLAY_CARDS',
      playerId: 0,
      cardIds: [...this.ui.selectedCardIds],
    });
  }

  public async pass(): Promise<boolean> {
    if (this.state.currentPlayer !== 0 || this.state.phase !== 'RESPONDING') return false;
    return this.dispatch({ kind: 'PASS', playerId: 0 });
  }

  public async submitGouCha(): Promise<boolean> {
    const prompt = this.viewModel.gouCha;
    if (prompt === null) return false;
    try {
      return await this.dispatch(buildGouChaAction(prompt, this.ui.selectedCardIds));
    } catch {
      this.errorCode = 'INVALID_GOUCHA_SELECTION';
      this.publish();
      return false;
    }
  }

  public async declineGouCha(): Promise<boolean> {
    const prompt = this.viewModel.gouCha;
    if (prompt === null) return false;
    return this.dispatch(buildDeclineAction(prompt.playerId));
  }

  private async dispatch(action: GameAction): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.errorCode = null;
    this.publish();
    try {
      const result = await this.controller.dispatch(action);
      if (!result.ok) {
        this.errorCode = result.error.code;
        return false;
      }
      this.ui = clearSelection(this.ui);
      return true;
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  private publish(events: readonly GameEvent[] = [], state = this.state): void {
    const snapshot: BrowserSessionSnapshot = {
      state,
      viewModel: buildTableViewModel(state, this.ui),
      selectedCardIds: [...this.ui.selectedCardIds],
      events: [...events],
      isBusy: this.busy,
      errorCode: this.errorCode,
    };
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A browser renderer failure cannot change or roll back the authoritative rules state.
      }
    }
  }
}
