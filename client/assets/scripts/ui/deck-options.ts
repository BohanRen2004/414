import { DEFAULT_DECK_COUNT, DeckCount, PlayerCount, SMALL_TABLE_HAND, deckSize } from '../core/cards/deck';

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

/** One choice of table size on the start screen. */
export interface PlayerOptionViewModel {
  readonly playerCount: PlayerCount;
  readonly label: string;
  /** e.g. "两队 · 2 对 2" or "一副牌 · 每人 18 张 · 各打各的". */
  readonly summary: string;
}

export function playerOption(playerCount: PlayerCount): PlayerOptionViewModel {
  if (playerCount === 4) return { playerCount, label: '4 人', summary: '两队 · 你和对面的搭档一队' };
  const hand = SMALL_TABLE_HAND[playerCount];
  const setAside = 54 - hand * playerCount;
  return {
    playerCount,
    label: `${playerCount} 人`,
    summary: `一副牌 · 每人 ${hand} 张${setAside > 0 ? `，扣 ${setAside} 张` : ''} · 各打各的`,
  };
}

export const PLAYER_OPTIONS: readonly PlayerOptionViewModel[] = [playerOption(4), playerOption(3), playerOption(2)];
