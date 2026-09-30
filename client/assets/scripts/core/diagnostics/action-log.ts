import { GamePhase } from '../state/game-state';
import { PlayerId } from '../cards/card';

export interface DiagnosticEntry {
  readonly level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR';
  readonly seed: number | null;
  readonly rulesVersion: string;
  readonly actionNumber: number;
  readonly phase: GamePhase;
  readonly playerId?: PlayerId;
  readonly code: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

/** Serialize local diagnostics as stable JSON Lines; this function performs no I/O. */
export function formatDiagnosticLog(entries: readonly DiagnosticEntry[]): string {
  return entries.map((entry) => {
    const details = Object.fromEntries(
      Object.keys(entry.details).sort().map((key) => [key, entry.details[key]]),
    );
    const record: Record<string, unknown> = {
      seed: entry.seed,
      rulesVersion: entry.rulesVersion,
      actionNumber: entry.actionNumber,
      phase: entry.phase,
    };
    if (entry.playerId !== undefined) record.playerId = entry.playerId;
    record.code = entry.code;
    record.details = details;
    record.level = entry.level;
    return JSON.stringify(record);
  }).join('\n');
}
