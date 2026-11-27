import { PlayerId } from '../core/cards/card';
import { GameEvent } from '../core/state/game-event';
import { GameState } from '../core/state/game-state';
import { gouChaPendingFrame, hidesGouChaQuery } from './visible-state';

/**
 * One screen to show a seat: events and the rules state behind them. The state is still authoritative;
 * the screen shows `visibleStateFor(state, viewerId)`.
 */
export interface SeatFrame {
  readonly events: readonly GameEvent[];
  readonly state: GameState;
}

/** Events that belong to the outcome after a pending CHA/GOU frame rather than to the frame itself. */
function isOutcomeEvent(event: GameEvent): boolean {
  return event.kind === 'TURN_CHANGED' || event.kind === 'TRICK_RESET';
}

/**
 * Turns committed rules transitions into the frames one seat sees, the way it would see them if hidden
 * gou-cha queries did not exist. Pure and deterministic, so the browser session and the online server
 * (which replays the action log) produce the same frames.
 *
 * Another seat's decline is never shown.
 *
 * An action that opens another seat's query on a single nobody has CHA'd is held back until the query
 * ends, then shown with its outcome (the viewer's own prompt or the ordinary response), or, if a CHA ends
 * it, shown just before that CHA. The viewer's own action is the exception: it is shown at once, looking
 * like the ordinary response it would close into, because the viewer knows what they did.
 *
 * Every CHA/GOU, and the viewer's own decline once a CHA has happened, is followed by one neutral pending
 * frame (the chain on the table, nobody to act) and then by the next public outcome: the viewer's prompt,
 * the next CHA/GOU, or the trick reset of a dead chain. The pending frame is shown even when the rules
 * core already closed the chain because nobody could continue, so the frames never reveal whether
 * anybody was asked.
 */
export class SeatPresenter {
  private deferred: SeatFrame | null = null;
  private committed: GameState;

  public constructor(public readonly viewerId: PlayerId, initial: GameState) {
    this.committed = initial;
  }

  /** Frames to show for one committed transition; `ownAction` marks a transition the viewer made. */
  public transition(events: readonly GameEvent[], state: GameState, ownAction = false): SeatFrame[] {
    const before = this.committed;
    this.committed = state;
    const viewerId = this.viewerId;
    const hidden = hidesGouChaQuery(state, viewerId);
    if (events.some((event) => event.kind === 'GOUCHA_DECLINED' && event.playerId !== viewerId)) {
      if (hidden) return [];
      const deferred = this.deferred;
      this.deferred = null;
      return [{ events: deferred?.events ?? events, state }];
    }
    const frames: SeatFrame[] = [];
    if (this.deferred !== null) {
      frames.push(this.deferred);
      this.deferred = null;
    }
    const pending = gouChaPendingFrame(before, state);
    if (pending !== null) {
      frames.push({ events: events.filter((event) => !isOutcomeEvent(event)), state: pending });
      if (!hidden) frames.push({ events: events.filter(isOutcomeEvent), state });
      return frames;
    }
    if (hidden && !ownAction) {
      this.deferred = { events, state };
      return frames;
    }
    frames.push({ events, state });
    return frames;
  }

  /** Forget a held-back frame; the caller shows the current state itself. */
  public dropDeferred(): void {
    this.deferred = null;
  }

  /** Restart from a state shown directly (e.g. after a renderer failure). */
  public reset(state: GameState): void {
    this.committed = state;
    this.deferred = null;
  }
}
