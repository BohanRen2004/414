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

export interface AnimationQueueOptions {
  readonly timeoutMs: number;
}

/** Plays each event in order and can restore a presentation from authoritative state. */
export class AnimationQueue implements AnimationSink {
  public constructor(
    private readonly renderer: EventRenderer,
    private readonly options: AnimationQueueOptions,
  ) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new RangeError('animation timeoutMs must be a positive finite number');
    }
  }

  public async play(events: readonly GameEvent[], _state: GameState): Promise<void> {
    for (const event of events) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.renderer.playEvent(event),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error(`animation timed out after ${this.options.timeoutMs}ms`)), this.options.timeoutMs);
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }
  }

  public snapTo(state: GameState): void {
    this.renderer.renderState(state);
  }
}
