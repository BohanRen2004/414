import { PlayerId } from '../../client/assets/scripts/core/cards/card';
import { DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { createSetupState } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameEvent } from '../../client/assets/scripts/core/state/game-event';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import {
  RoomRequest, RoomResponse, RoomView, SyncCursor, TURN_TIME_MS, WireFrame, seatMove,
} from '../../client/assets/scripts/online/protocol';
import { fromWireState } from '../../client/assets/scripts/online/wire';
import { buildDeclineAction, buildGouChaAction } from '../../client/assets/scripts/ui/goucha-actions';
import { clearSelection, nextHint, toggleCard } from '../../client/assets/scripts/ui/hand-selection';
import { rankedHintActions } from '../../client/assets/scripts/ui/hints';
import { HumanUiState, buildTableViewModel } from '../../client/assets/scripts/ui/table-view-model';
import { BrowserSessionSnapshot } from '../../web/src/browser-session';

/** How the client reaches the `room` cloud function and hears that it should sync. */
export interface RoomTransport {
  call(request: RoomRequest): Promise<RoomResponse>;
  /**
   * Listen for this player's inbox changes; `onPoke` means "sync now", `onError` that the listener died.
   * Returns a function that stops listening. Polling keeps the game going when this fails.
   */
  watch(onPoke: () => void, onError: () => void): () => void;
}

export interface OnlineTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface OnlineOptions {
  /** Pause after each shown move. */
  readonly animationDelayMs?: number;
  /** Poll interval while the realtime listener is down, and the safety-net interval while it works. */
  readonly pollMs?: number;
  readonly watchedPollMs?: number;
}

export interface OnlineSnapshot extends BrowserSessionSnapshot {
  readonly room: RoomView;
  /** Whole seconds the viewer has left for the decision in front of them; null when it is not their turn. */
  readonly secondsLeft: number | null;
  /** Whether the AI plays the viewer's seat (托管). */
  readonly auto: boolean;
}

export type OnlineListener = (snapshot: OnlineSnapshot) => void;

type Ok = Extract<RoomResponse, { ok: true }>;

/**
 * The mini game's side of an online room. Everything authoritative happens in the cloud function; this
 * keeps the room view, plays the seat's frames in order with a short pause each, and turns taps into
 * requests. It never has more than its own hand: other hands arrive as card counts (wire.ts).
 */
export class OnlineSession {
  private room: RoomView;
  private cursor: SyncCursor | null = null;
  private shown: GameState | null = null;
  private readonly queue: WireFrame[] = [];
  private presenting = false;
  private requesting = false;
  private syncing = false;
  private syncAgain = false;
  private ui: HumanUiState;
  private errorCode: string | null = null;
  private deadline: number | null = null;
  private clockOffset = 0;
  private lastProgress: number;
  private readonly listeners = new Set<OnlineListener>();
  private pollTimer: unknown = null;
  private stopWatch: (() => void) | null = null;
  private watchHealthy = false;
  private closed = false;
  private readonly animationDelayMs: number;
  private readonly pollMs: number;
  private readonly watchedPollMs: number;
  private lastEvents: readonly GameEvent[] = [];

  public constructor(
    private readonly transport: RoomTransport,
    private readonly timers: OnlineTimers,
    initial: Ok,
    options: OnlineOptions = {},
  ) {
    this.animationDelayMs = options.animationDelayMs ?? 320;
    this.pollMs = options.pollMs ?? 2500;
    this.watchedPollMs = options.watchedPollMs ?? 10_000;
    this.room = initial.room;
    this.ui = { humanPlayerId: initial.room.mySeat ?? 0, selectedCardIds: [], hintIndex: 0 };
    this.lastProgress = timers.now();
    this.absorb(initial);
    try {
      this.stopWatch = transport.watch(() => this.sync(), () => { this.watchHealthy = false; });
      this.watchHealthy = true;
    } catch {
      this.watchHealthy = false;
    }
    this.schedulePoll();
  }

  public get view(): RoomView {
    return this.room;
  }

  public get isBusy(): boolean {
    return this.requesting || this.presenting;
  }

  public get lastErrorCode(): string | null {
    return this.errorCode;
  }

  public get selectedCardIds(): readonly string[] {
    return [...this.ui.selectedCardIds];
  }

  /** The state on screen (the latest shown frame); a placeholder table in the lobby. */
  public get state(): GameState {
    return this.shown ?? createSetupState();
  }

  public subscribe(listener: OnlineListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  public snapshot(): OnlineSnapshot {
    const state = this.state;
    const seat = this.room.mySeat ?? 0;
    const viewModel = buildTableViewModel(state, { ...this.ui, humanPlayerId: seat });
    const left = this.deadline === null || this.isBusy ? null
      : Math.max(0, Math.ceil((this.deadline - this.timers.now()) / 1000));
    return {
      state,
      viewModel,
      selectedCardIds: [...this.ui.selectedCardIds],
      events: this.lastEvents,
      isBusy: this.isBusy,
      errorCode: this.errorCode,
      room: this.room,
      secondsLeft: left,
      auto: this.room.mySeat !== null && this.room.seats[this.room.mySeat].auto,
    };
  }

  // --- Lobby and room actions ----------------------------------------------------------------------------

  public start(): Promise<boolean> {
    return this.request({ type: 'start', roomId: this.room.roomId, cursor: this.cursor });
  }

  public setDeckCount(deckCount: DeckCount): Promise<boolean> {
    return this.request({ type: 'deck', roomId: this.room.roomId, deckCount });
  }

  public moveSeat(seat: PlayerId): Promise<boolean> {
    return this.request({ type: 'seat', roomId: this.room.roomId, seat });
  }

  public setAuto(on: boolean): Promise<boolean> {
    if (on) this.ui = clearSelection(this.ui);
    return this.request({ type: 'auto', roomId: this.room.roomId, on, cursor: this.cursor });
  }

  public backToLobby(): Promise<boolean> {
    return this.request({ type: 'lobby', roomId: this.room.roomId, cursor: this.cursor });
  }

  public async leave(): Promise<boolean> {
    const left = await this.request({ type: 'leave', roomId: this.room.roomId });
    this.close();
    return left;
  }

  /** Stop listening and polling; the session is done. */
  public close(): void {
    this.closed = true;
    this.stopWatch?.();
    this.stopWatch = null;
    if (this.pollTimer !== null) this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.listeners.clear();
  }

  // --- Playing --------------------------------------------------------------------------------------------

  public toggleCard(cardId: string): void {
    if (this.isBusy || this.room.mySeat === null) return;
    this.ui = toggleCard(this.ui, cardId, this.state.players[this.room.mySeat].hand);
    this.errorCode = null;
    this.publish();
  }

  /** Replace the selection, e.g. while dragging across the hand; cards not in the hand are dropped. */
  public setSelection(cardIds: readonly string[]): void {
    if (this.isBusy || this.room.mySeat === null) return;
    const hand = new Set(this.state.players[this.room.mySeat].hand.map((card) => card.id));
    const next = [...new Set(cardIds)].filter((id) => hand.has(id));
    if (next.length === this.ui.selectedCardIds.length && next.every((id, index) => id === this.ui.selectedCardIds[index])) return;
    this.ui = { ...this.ui, selectedCardIds: next, hintIndex: 0 };
    this.errorCode = null;
    this.publish();
  }

  public clearSelection(): void {
    if (this.isBusy) return;
    this.ui = clearSelection(this.ui);
    this.errorCode = null;
    this.publish();
  }

  public cycleHint(): void {
    if (this.isBusy || this.room.mySeat === null) return;
    this.ui = nextHint(this.ui, rankedHintActions(this.state, this.room.mySeat));
    this.errorCode = null;
    this.publish();
  }

  public async playSelection(): Promise<boolean> {
    const seat = this.room.mySeat;
    if (seat === null || !this.snapshot().viewModel.controls.playEnabled) return false;
    return this.move({ kind: 'PLAY_CARDS', playerId: seat, cardIds: [...this.ui.selectedCardIds] });
  }

  public async pass(): Promise<boolean> {
    const seat = this.room.mySeat;
    if (seat === null || this.state.currentPlayer !== seat || this.state.phase !== 'RESPONDING') return false;
    return this.move({ kind: 'PASS', playerId: seat });
  }

  public async submitGouCha(): Promise<boolean> {
    const prompt = this.snapshot().viewModel.gouCha;
    if (prompt === null || this.isBusy) return false;
    try {
      return await this.move(buildGouChaAction(prompt, this.ui.selectedCardIds));
    } catch {
      this.errorCode = 'INVALID_GOUCHA_SELECTION';
      this.publish();
      return false;
    }
  }

  public async declineGouCha(): Promise<boolean> {
    const prompt = this.snapshot().viewModel.gouCha;
    if (prompt === null || this.isBusy) return false;
    return this.move(buildDeclineAction(prompt.playerId));
  }

  /** Ask the server for anything new; overlapping calls collapse into one more round. */
  public async sync(): Promise<void> {
    if (this.closed) return;
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        // Stuck on someone else for longer than their time limit: ask the server to let the AI step in.
        const stalled = this.room.status === 'playing' && this.deadline === null
          && this.timers.now() - this.lastProgress > TURN_TIME_MS + 2000;
        const response = await this.transport.call({ type: stalled ? 'tick' : 'sync', roomId: this.room.roomId, cursor: this.cursor });
        if (stalled) this.lastProgress = this.timers.now() - TURN_TIME_MS + 8000;
        if (response.ok) this.absorb(response);
        else if (response.code === 'ROOM_NOT_FOUND' || response.code === 'NOT_IN_ROOM') this.lostRoom();
      } while (this.syncAgain && !this.closed);
    } catch {
      // Network trouble: the next poll tries again.
    } finally {
      this.syncing = false;
    }
  }

  private async move(action: GameAction): Promise<boolean> {
    if (this.isBusy) return false;
    const selection = this.ui;
    this.ui = clearSelection(this.ui);
    const ok = await this.request({ type: 'move', roomId: this.room.roomId, move: seatMove(action), cursor: this.cursor });
    if (!ok) this.ui = selection;
    this.publish();
    return ok;
  }

  private async request(request: RoomRequest): Promise<boolean> {
    if (this.isBusy || this.closed) return false;
    this.requesting = true;
    this.errorCode = null;
    this.publish();
    try {
      const response = await this.transport.call(request);
      if (!response.ok) {
        this.errorCode = response.code === 'RULE_REJECTED' ? response.ruleCode ?? response.code : response.code;
        if (response.code === 'ROOM_NOT_FOUND' || response.code === 'NOT_IN_ROOM') this.lostRoom();
        return false;
      }
      this.requesting = false;
      this.absorb(response);
      return true;
    } catch {
      this.errorCode = 'NETWORK';
      return false;
    } finally {
      this.requesting = false;
      this.publish();
    }
  }

  private lostRoom(): void {
    this.room = { ...this.room, status: 'closed', mySeat: null };
    this.publish();
  }

  /** Take in a server reply: the room view, and new frames queued to be shown in order. */
  private absorb(response: Ok): void {
    const now = this.timers.now();
    this.clockOffset = response.serverTime - now;
    this.room = response.room;
    if (this.room.mySeat !== null) this.ui = { ...this.ui, humanPlayerId: this.room.mySeat };
    const game = response.game;
    if (this.room.status === 'lobby') {
      this.queue.length = 0;
      this.shown = null;
      this.deadline = null;
      this.cursor = null;
      this.ui = clearSelection(this.ui);
    } else if (game !== null) {
      const sameGame = this.cursor !== null && this.cursor.gameNo === game.gameNo;
      if (!sameGame) {
        this.queue.length = 0;
        this.shown = null;
        this.ui = clearSelection(this.ui);
      }
      const known = sameGame ? this.cursor!.frames : 0;
      // When the server skipped ahead, drop what is still queued and show its latest frame.
      if (game.from > known) this.queue.length = 0;
      const fresh = game.frames.slice(Math.max(0, known - game.from));
      if (fresh.length > 0) this.lastProgress = now;
      this.queue.push(...fresh);
      this.cursor = { gameNo: game.gameNo, frames: Math.max(known, game.from + game.frames.length) };
      this.deadline = game.myDeadline === null ? null : game.myDeadline - this.clockOffset;
    }
    void this.present();
    this.publish();
  }

  private async present(): Promise<void> {
    if (this.presenting) return;
    this.presenting = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        const frame = this.queue.shift()!;
        const seat = this.room.mySeat ?? 0;
        this.shown = fromWireState(frame.state, seat);
        this.lastEvents = frame.events;
        // Cards picked ahead of the turn stay picked while they are still in the hand.
        const hand = new Set(this.shown.players[seat].hand.map((card) => card.id));
        if (this.ui.selectedCardIds.some((id) => !hand.has(id))) {
          this.ui = { ...this.ui, selectedCardIds: this.ui.selectedCardIds.filter((id) => hand.has(id)), hintIndex: 0 };
        }
        if (this.queue.length === 0) this.presenting = false;
        this.publish();
        if (this.queue.length > 0) await this.wait(this.animationDelayMs);
      }
    } finally {
      this.presenting = false;
    }
    this.publish();
  }

  private wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => { this.timers.setTimeout(resolve, ms); });
  }

  private schedulePoll(): void {
    if (this.closed) return;
    const interval = this.watchHealthy ? this.watchedPollMs : this.pollMs;
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = null;
      void this.sync().finally(() => this.schedulePoll());
    }, interval);
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A renderer failure must not break the session.
      }
    }
  }
}
