import { ActionResult, applyAction } from '../../client/assets/scripts/core/rules/reducer';
import { GameAction } from '../../client/assets/scripts/core/state/game-action';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { RuleErrorCode } from '../../client/assets/scripts/core/state/rule-error';

export function expectSuccess(result: ActionResult): Extract<ActionResult, { ok: true }> {
  if (!result.ok) throw new Error(`Expected success, got ${result.error.code}`);
  return result;
}

export function errorCode(result: ActionResult): RuleErrorCode | null {
  return result.ok ? null : result.error.code;
}

export function dispatch(state: GameState, action: GameAction): GameState {
  return expectSuccess(applyAction(state, action)).state;
}
