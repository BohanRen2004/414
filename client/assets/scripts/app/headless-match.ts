import { GameController } from './game-controller';
import { AnimationSink } from './animation-queue';
import { applyAction, createSetupState } from '../core/rules/reducer';
import { DEFAULT_DECK_COUNT, DeckCount } from '../core/cards/deck';
import { GameState } from '../core/state/game-state';

export interface HeadlessMatchResult {
  readonly finalState: GameState;
  /** Successful gameplay actions after the deterministic deal. */
  readonly actionCount: number;
  readonly rejectedActions: number;
  readonly diagnosticLog: string;
}

const immediateAnimationSink: AnimationSink = {
  play: async () => undefined,
  snapTo: () => undefined,
};

/** Play one all-AI game of the given deck version (two decks by default) to its result. */
export async function runHeadlessMatch(
  seed: number,
  maxActions = 20_000,
  deckCount: DeckCount = DEFAULT_DECK_COUNT,
): Promise<HeadlessMatchResult> {
  if (!Number.isSafeInteger(maxActions) || maxActions < 0) {
    throw new RangeError('maxActions must be a nonnegative safe integer');
  }
  const started = applyAction(createSetupState(), { kind: 'START_GAME', seed, deckCount });
  if (!started.ok) throw new Error(`Could not start headless match: ${started.error.code}`);

  const [seat0, seat1, seat2, seat3] = started.state.players;
  const allAiState: GameState = {
    ...started.state,
    players: [
      { ...seat0, controlType: 'BASIC_AI' },
      { ...seat1, controlType: 'BASIC_AI' },
      { ...seat2, controlType: 'BASIC_AI' },
      { ...seat3, controlType: 'BASIC_AI' },
    ],
  };
  const controller = new GameController(allAiState, immediateAnimationSink);
  await controller.advanceAiTurns(maxActions);

  if (controller.state.phase !== 'ROUND_RESULT' || controller.rejectedActionCount !== 0) {
    throw new Error(
      `Headless match incomplete: deckCount=${deckCount}; seed=${seed}; actionCount=${controller.actionCount}; ` +
      `rejectedActions=${controller.rejectedActionCount}; diagnosticLog=${controller.diagnosticLog}`,
    );
  }

  return {
    finalState: controller.state,
    actionCount: controller.actionCount,
    rejectedActions: controller.rejectedActionCount,
    diagnosticLog: controller.diagnosticLog,
  };
}
