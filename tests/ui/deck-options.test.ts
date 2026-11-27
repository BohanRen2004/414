import { describe, expect, it } from 'vitest';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { DECK_OPTIONS, deckOption } from '../../client/assets/scripts/ui/deck-options';

describe('deck version options', () => {
  it('offers one deck and two decks, defaulting to two decks', () => {
    expect(DECK_OPTIONS.map((option) => option.deckCount)).toEqual([1, 2]);
    expect(DECK_OPTIONS.filter((option) => option.isDefault).map((option) => option.deckCount)).toEqual([2]);
  });

  it('shows the card counts of each version', () => {
    expect(deckOption(1)).toMatchObject({
      label: '一副牌',
      totalCards: 54,
      handSizeLabel: '13/14',
      summary: '54 张牌 · 每人 13/14 张',
    });
    expect(deckOption(2)).toMatchObject({
      label: '两副牌',
      totalCards: 108,
      handSizeLabel: '27',
      summary: '108 张牌 · 每人 27 张',
    });
  });

  it('matches the hand sizes actually dealt', () => {
    for (const deckCount of [1, 2] as const) {
      const sizes = [...new Set(dealFourPlayers(414, deckCount).hands.map((hand) => hand.length))].sort((a, b) => a - b);
      expect(sizes.join('/')).toBe(deckOption(deckCount).handSizeLabel);
    }
  });
});
