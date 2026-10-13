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
import { hidesGouChaQuery, visibleEventsFor, visibleStateFor } from '../../client/assets/scripts/ui/visible-state';

export interface BrowserGameOptions {
  readonly animationDelayMs?: number;
  /** Start from this state instead of an unstarted table (tests and replays). */
  readonly initialState?: GameState;
}

export interface BrowserSessionSnapshot {
  /** What the human may see: another seat's gou-cha query is shown as the ordinary response it closes into. */
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
  /** A shown action that opened another seat's hidden gou-cha query, held back until the query ends. */
  private deferred: { readonly events: readonly GameEvent[]; readonly state: GameState } | null = null;
  /** State behind the screen last published; it trails the rules state while AI turns are presented. */
  private shown: GameState;

  public constructor(public readonly seed: number, options: BrowserGameOptions = {}) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError('seed must be an unsigned 32-bit integer');
    }
    this.animationDelayMs = options.animationDelayMs ?? 130;
    if (!Number.isFinite(this.animationDelayMs) || this.animationDelayMs < 0) {
      throw new RangeError('animationDelayMs must be a nonnegative finite number');
    }

    const sink: AnimationSink = {
      play: (events, state) => this.present(events, state),
      snapTo: (state) => this.publish([], state),
    };
    this.controller = new GameController(options.initialState ?? createSetupState(), sink);
    this.shown = this.controller.state;
  }

  /** Authoritative rules state; render `snapshot().state` instead, which hides other seats' gou-cha queries. */
  public get state(): GameState {
    return this.controller.state;
  }

  public get viewModel(): TableViewModel {
    return buildTableViewModel(visibleStateFor(this.shown, this.ui.humanPlayerId), this.ui);
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

  /** The screen currently shown; re-rendering it mid-animation must not reveal later rules state. */
  public snapshot(events: readonly GameEvent[] = []): BrowserSessionSnapshot {
    return this.buildSnapshot(events, this.shown);
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
    if (this.busy) return;
    this.ui = toggleCard(this.ui, cardId, this.state.players[0].hand);
    this.errorCode = null;
    this.publish();
  }

  public clearSelection(): void {
    if (this.busy) return;
    this.ui = clearSelection(this.ui);
    this.errorCode = null;
    this.publish();
  }

  public cycleHint(): void {
    if (this.busy) return;
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
    if (prompt === null || this.busy) return false;
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
    if (prompt === null || this.busy) return false;
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
      this.deferred = null;
      this.publish();
    }
  }

  /**
   * Show one committed transition the way the human would see it if hidden queries did not exist.
   * Another seat's decline is never shown and takes no animation time. An action that opens another
   * seat's query is held back until the query ends, then shown with its outcome (the human's own
   * prompt or the ordinary response), or, if a CHA/GOU ends it, shown just before that addition.
   */
  private async present(events: readonly GameEvent[], state: GameState): Promise<void> {
    const humanId = this.ui.humanPlayerId;
    const deferred = this.deferred;
    if (events.some((event) => event.kind === 'GOUCHA_DECLINED' && event.playerId !== humanId)) {
      if (deferred === null || hidesGouChaQuery(state, humanId)) return;
      this.deferred = null;
      await this.show(deferred.events, state);
      return;
    }
    if (deferred !== null) {
      this.deferred = null;
      await this.show(deferred.events, deferred.state);
    }
    if (hidesGouChaQuery(state, humanId)) {
      this.deferred = { events, state };
      return;
    }
    await this.show(events, state);
  }

  private async show(events: readonly GameEvent[], state: GameState): Promise<void> {
    this.publish(events, state);
    await wait(this.animationDelayMs);
  }

  private buildSnapshot(events: readonly GameEvent[], state: GameState): BrowserSessionSnapshot {
    const visible = visibleStateFor(state, this.ui.humanPlayerId);
    return {
      state: visible,
      viewModel: buildTableViewModel(visible, this.ui),
      selectedCardIds: [...this.ui.selectedCardIds],
      events: visibleEventsFor(events, visible, this.ui.humanPlayerId),
      isBusy: this.busy,
      errorCode: this.errorCode,
    };
  }

  private publish(events: readonly GameEvent[] = [], state = this.state): void {
    this.shown = state;
    const snapshot = this.buildSnapshot(events, state);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A browser renderer failure cannot change or roll back the authoritative rules state.
      }
    }
  }
}
