import { GameEvent } from '../core/state/game-event';
import { GameState } from '../core/state/game-state';

export interface AnimationSink {
  play(events: readonly GameEvent[], state: GameState): Promise<void>;
  snapTo(state: GameState): void;
}

export interface EventRenderer {
  playEvent(event: GameEvent): Promise<void>;
  renderState(state: GameState): void;
}

/** Plays each event in order and can restore a presentation from authoritative state. */
export class AnimationQueue implements AnimationSink {
  public constructor(private readonly renderer: EventRenderer) {}

  public async play(events: readonly GameEvent[], _state: GameState): Promise<void> {
    for (const event of events) await this.renderer.playEvent(event);
  }

  public snapTo(state: GameState): void {
    this.renderer.renderState(state);
  }
}
