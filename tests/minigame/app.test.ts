import { describe, expect, it } from 'vitest';
import { MiniGameApp, Platform } from '../../minigame/src/app';
import { Canvas2D, HitRegion, Rect } from '../../minigame/src/render';
import { buildTableScreen } from '../../minigame/src/screen';

/** A canvas that draws nothing but records every coordinate, so NaN or off-screen layout shows up in tests. */
function fakeCanvas(): Canvas2D & { readonly numbers: number[]; readonly texts: string[] } {
  const numbers: number[] = [];
  const texts: string[] = [];
  const record = (...values: number[]) => { numbers.push(...values); };
  return {
    numbers,
    texts,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '12px sans-serif', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
    fillRect: record, moveTo: record, lineTo: record, arcTo: record, arc: record,
    fillText(value: string, x: number, y: number) { texts.push(value); record(x, y); },
    measureText(value: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12);
      return { width: [...value].length * size * 0.6 };
    },
  };
}

function platform(width = 844, height = 390): Platform & { readonly canvas: ReturnType<typeof fakeCanvas> } {
  const canvas = fakeCanvas();
  return {
    canvas,
    context: canvas,
    viewport: { width, height, insetLeft: 44, insetRight: 44, insetTop: 0, insetBottom: 21 },
    random: () => 0.25,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
}

function center(rect: Rect): [number, number] {
  return [rect.x + rect.w / 2, rect.y + rect.h / 2];
}

function regionFor(app: MiniGameApp, action: string): HitRegion | undefined {
  return app.tappable.find((region) => 'action' in region && region.action === action);
}

async function tapAction(app: MiniGameApp, action: string): Promise<boolean> {
  const region = regionFor(app, action);
  if (region === undefined) return false;
  await app.tap(...center(region.rect));
  return true;
}

/** Finish the game by tapping what is on screen: hint then play, else pass; decline every gou-cha prompt. */
async function finishByTaps(app: MiniGameApp): Promise<number> {
  let turns = 0;
  while (app.current.state.phase !== 'ROUND_RESULT') {
    turns += 1;
    if (turns > 400) throw new Error('game did not finish');
    if (await tapAction(app, 'decline-goucha')) continue;
    await tapAction(app, 'hint');
    if (await tapAction(app, 'play')) continue;
    if (await tapAction(app, 'pass')) continue;
    throw new Error(`no move available in ${app.current.state.phase}`);
  }
  return turns;
}

async function playByTaps(app: MiniGameApp): Promise<number> {
  expect(await tapAction(app, 'start')).toBe(true);
  return finishByTaps(app);
}

describe('WeChat mini game app', () => {
  it.each([1, 2] as const)('plays a complete %i-deck game by tapping the screen', async (deckCount) => {
    const host = platform();
    const app = new MiniGameApp(host, { animationDelayMs: 0 });
    app.render();
    await tapAction(app, deckCount === 1 ? 'deck-1' : 'deck-2');
    expect(app.current.deckCount).toBe(deckCount);
    const turns = await playByTaps(app);
    expect(turns).toBeGreaterThan(0);
    expect(app.current.state.result).not.toBeNull();
    expect(regionFor(app, 'replay')).toBeDefined();
    expect(host.canvas.numbers.every(Number.isFinite)).toBe(true);
    expect(host.canvas.texts.some((value) => value.includes('拿下这局'))).toBe(true);
  });

  it('selects a hand card by tapping it and the same seed replays the same game', async () => {
    const app = new MiniGameApp(platform(), { animationDelayMs: 0 });
    app.render();
    await tapAction(app, 'start');
    const first = app.current.state;
    const card = app.tappable.find((region): region is Extract<HitRegion, { cardId: string }> => 'cardId' in region);
    if (app.current.state.currentPlayer === 0) {
      expect(card).toBeDefined();
      await app.tap(...center(card!.rect));
      expect(app.current.selectedCardIds).toEqual([card!.cardId]);
    }
    await finishByTaps(app);
    await tapAction(app, 'replay');
    expect(app.current.state.players.map((player) => player.hand.length))
      .toEqual(first.players.map((player) => player.hand.length));
    expect(app.current.state.players[0].hand).toEqual(first.players[0].hand);
  });

  it('selects several cards with one slide across the hand', async () => {
    const app = new MiniGameApp(platform(), { animationDelayMs: 0 });
    await app.perform('start');
    // Get to an ordinary turn of the human's, where every hand card can be picked.
    for (let guard = 0; app.current.state.phase === 'GOUCHA_QUERY' || app.current.state.currentPlayer !== 0; guard += 1) {
      expect(guard).toBeLessThan(10);
      await app.perform(app.current.state.phase === 'GOUCHA_QUERY' ? 'decline-goucha' : 'new-game');
      if (app.current.state.phase === 'SETUP') await app.perform('start');
    }
    const cards = app.tappable.filter((region): region is Extract<HitRegion, { cardId: string }> => 'cardId' in region);
    expect(cards.length).toBeGreaterThan(5);
    const y = cards[0]!.rect.y + cards[0]!.rect.h - 4;
    const mid = (index: number) => cards[index]!.rect.x + Math.min(cards[index]!.rect.w, 10) / 2;

    // Slide from the 2nd card to the 5th: four cards picked; sliding back to the 3rd drops two.
    app.touchStart(1, mid(1), y);
    app.touchMove(1, mid(3), y - 30);
    app.touchMove(1, mid(4), y + 40);
    expect(app.current.selectedCardIds).toHaveLength(4);
    app.touchMove(1, mid(2), y);
    await app.touchEnd(1, mid(2), y);
    expect([...app.current.selectedCardIds].sort()).toEqual([cards[1]!.cardId, cards[2]!.cardId].sort());

    // Starting on a picked card clears instead.
    app.touchStart(2, mid(1), y);
    app.touchMove(2, mid(0), y);
    await app.touchEnd(2, mid(0), y);
    expect(app.current.selectedCardIds).toEqual([cards[2]!.cardId]);

    // A touch that stays on one card toggles it; past the last card selects through to the end.
    app.touchStart(3, mid(2), y);
    await app.touchEnd(3, mid(2) + 3, y);
    expect(app.current.selectedCardIds).toEqual([]);
    app.touchStart(4, mid(cards.length - 2), y);
    await app.touchEnd(4, 99_999, y);
    expect([...app.current.selectedCardIds].sort()).toEqual(cards.slice(-2).map((card) => card.cardId).sort());

    // A slide that starts on a button is not a tap.
    const clear = app.tappable.find((region) => 'action' in region && region.action === 'clear')!;
    app.touchStart(5, ...center(clear.rect));
    await app.touchEnd(5, center(clear.rect)[0] + 40, center(clear.rect)[1]);
    expect(app.current.selectedCardIds).toHaveLength(2);
    app.touchStart(6, ...center(clear.rect));
    await app.touchEnd(6, ...center(clear.rect));
    expect(app.current.selectedCardIds).toEqual([]);
  });

  it('keeps every drawn coordinate finite on small and large screens', () => {
    for (const [width, height] of [[667, 375], [844, 390], [1280, 720], [2400, 1080]] as const) {
      const host = platform(width, height);
      new MiniGameApp(host, { animationDelayMs: 0 }).render();
      expect(host.canvas.numbers.every(Number.isFinite)).toBe(true);
    }
  });

  it('never puts another seat\'s cards on screen', async () => {
    const app = new MiniGameApp(platform(), { animationDelayMs: 0 });
    await app.perform('start');
    const screen = buildTableScreen(app.current.snapshot(), 2, app.current.seed);
    const own = new Set(app.current.state.players[0].hand.map((card) => card.id));
    expect(screen.hand.cards.every((card) => own.has(card.id))).toBe(true);
    const hidden = app.current.state.players.slice(1).flatMap((player) => player.hand.map((card) => card.id));
    const shown = new Set([...screen.hand.cards, ...screen.center.cards].map((card) => card.id));
    expect(hidden.some((id) => shown.has(id))).toBe(false);
  });
});
