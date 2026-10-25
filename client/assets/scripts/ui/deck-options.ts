import { DEFAULT_DECK_COUNT, DeckCount, deckSize } from '../core/cards/deck';

/** One choice on the start screen: the game version and the card counts it deals. */
export interface DeckOptionViewModel {
  readonly deckCount: DeckCount;
  readonly isDefault: boolean;
  readonly label: '一副牌' | '两副牌';
  readonly totalCards: number;
  /** Cards per seat, e.g. "27", or "13/14" when the deal cannot be even. */
  readonly handSizeLabel: string;
  /** e.g. "54 张牌 · 每人 13/14 张". */
  readonly summary: string;
}

export function deckOption(deckCount: DeckCount): DeckOptionViewModel {
  const totalCards = deckSize(deckCount);
  const fewest = Math.floor(totalCards / 4);
  const handSizeLabel = totalCards % 4 === 0 ? `${fewest}` : `${fewest}/${fewest + 1}`;
  return {
    deckCount,
    isDefault: deckCount === DEFAULT_DECK_COUNT,
    label: deckCount === 1 ? '一副牌' : '两副牌',
    totalCards,
    handSizeLabel,
    summary: `${totalCards} 张牌 · 每人 ${handSizeLabel} 张`,
  };
}

export const DECK_OPTIONS: readonly DeckOptionViewModel[] = [deckOption(1), deckOption(2)];
