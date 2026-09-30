export type RuleErrorCode =
  | 'NOT_CURRENT_PLAYER'
  | 'WRONG_PHASE'
  | 'CARD_NOT_OWNED'
  | 'DUPLICATE_CARD_ID'
  | 'INVALID_PATTERN'
  | 'DOES_NOT_BEAT_CURRENT_PLAY'
  | 'PASS_NOT_ALLOWED'
  | 'WRONG_GOUCHA_STEP'
  | 'GOUCHA_COUNT_MISMATCH'
  | 'GOUCHA_RANK_MISMATCH'
  | 'SELF_GOUCHA_FORBIDDEN'
  | 'GAME_ALREADY_FINISHED';

export interface RuleError {
  readonly code: RuleErrorCode;
  readonly messageKey: string;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export function ruleError(
  code: RuleErrorCode,
  context: Readonly<Record<string, string | number | boolean>> = {},
): RuleError {
  return {
    code,
    messageKey: `rule.${code.toLowerCase()}`,
    context,
  };
}
