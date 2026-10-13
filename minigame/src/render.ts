import { Card, Rank } from '../../client/assets/scripts/core/cards/card';
import { DECK_OPTIONS } from '../../client/assets/scripts/ui/deck-options';
import { SUIT_GLYPH, isRedCard, rankLabel } from '../../client/assets/scripts/ui/labels';
import { ActionId, ButtonScreen, SeatScreen, TableScreen } from './screen';

/** The subset of the 2D canvas API used here; WeChat's canvas context and the browser's both provide it. */
export interface Canvas2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
  textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic' | 'hanging' | 'ideographic';
  globalAlpha: number;
  save(): void;
  restore(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Logical (CSS-pixel) size of the screen and the insets kept clear of notches and rounded corners. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly insetLeft: number;
  readonly insetRight: number;
  readonly insetTop: number;
  readonly insetBottom: number;
}

export type HitRegion =
  | { readonly rect: Rect; readonly action: ActionId }
  | { readonly rect: Rect; readonly cardId: string };

export interface Overlay {
  readonly help: boolean;
  readonly notice: string;
}

const COLOR = {
  bg: '#0d1715',
  felt: '#183b31',
  feltEdge: '#245343',
  panel: '#17231f',
  panelEdge: 'rgba(224,235,215,0.17)',
  ink: '#edf2e8',
  muted: '#94a49b',
  mint: '#a8d9bd',
  mintStrong: '#67bd91',
  gold: '#d6b981',
  blue: '#93c9d9',
  red: '#d26663',
  cardFace: '#f7f5ee',
  cardInk: '#1b2420',
  cardRed: '#c0392b',
  scrim: 'rgba(4,10,8,0.82)',
} as const;

const FONT = 'sans-serif';

function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${FONT}`;
}

function roundRect(ctx: Canvas2D, r: Rect, radius: number): void {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

function text(ctx: Canvas2D, value: string, x: number, y: number, size: number, color: string,
  align: Canvas2D['textAlign'] = 'left', weight = 400): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

/** Shorten text with an ellipsis so it fits `maxWidth`. */
function fit(ctx: Canvas2D, value: string, size: number, maxWidth: number, weight = 400): string {
  ctx.font = font(size, weight);
  if (ctx.measureText(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Break text into lines no wider than `maxWidth` (Chinese text breaks between any characters). */
function wrap(ctx: Canvas2D, value: string, size: number, maxWidth: number): string[] {
  ctx.font = font(size);
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (ctx.measureText(line + char).width > maxWidth && line !== '') {
        lines.push(line);
        line = char;
      } else {
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawCard(ctx: Canvas2D, card: Card, r: Rect, options: { selected?: boolean; dimmed?: boolean; showCopy?: boolean } = {}): void {
  roundRect(ctx, r, Math.max(3, r.w * 0.09));
  ctx.fillStyle = COLOR.cardFace;
  ctx.fill();
  ctx.lineWidth = options.selected ? 2 : 1;
  ctx.strokeStyle = options.selected ? COLOR.mintStrong : 'rgba(0,0,0,0.35)';
  ctx.stroke();
  const ink = isRedCard(card) ? COLOR.cardRed : COLOR.cardInk;
  const corner = Math.max(9, r.w * 0.3);
  const joker = card.rank === Rank.SMALL_JOKER || card.rank === Rank.BIG_JOKER;
  if (joker) {
    // Jokers print their two characters down the corner.
    const label = card.rank === Rank.BIG_JOKER ? '大王' : '小王';
    text(ctx, label[0]!, r.x + corner * 0.62, r.y + corner * 0.7, corner * 0.9, ink, 'center', 700);
    text(ctx, label[1]!, r.x + corner * 0.62, r.y + corner * 1.65, corner * 0.9, ink, 'center', 700);
  } else {
    text(ctx, rankLabel(card.rank), r.x + corner * 0.62, r.y + corner * 0.7, corner, ink, 'center', 700);
    text(ctx, SUIT_GLYPH[card.suit], r.x + corner * 0.62, r.y + corner * 1.6, corner * 0.82, ink, 'center');
  }
  if (r.w >= 34) text(ctx, SUIT_GLYPH[card.suit], r.x + r.w * 0.62, r.y + r.h * 0.62, r.w * 0.42, ink, 'center');
  if (options.showCopy && r.w >= 34) {
    text(ctx, card.deckIndex === 0 ? 'I' : 'II', r.x + r.w - 4, r.y + r.h - 7, 8, 'rgba(0,0,0,0.35)', 'right');
  }
  if (options.dimmed) {
    roundRect(ctx, r, Math.max(3, r.w * 0.09));
    ctx.fillStyle = 'rgba(13,23,21,0.55)';
    ctx.fill();
  }
}

function drawButton(ctx: Canvas2D, button: ButtonScreen, r: Rect, regions: HitRegion[]): void {
  roundRect(ctx, r, 7);
  const fill = button.style === 'primary' ? COLOR.mint : button.style === 'secondary' ? '#2a3b35' : COLOR.panel;
  ctx.globalAlpha = button.enabled ? 1 : 0.4;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.stroke();
  text(ctx, button.label, r.x + r.w / 2, r.y + r.h / 2, Math.min(15, r.h * 0.42), button.style === 'primary' ? '#10211d' : COLOR.ink, 'center', 600);
  ctx.globalAlpha = 1;
  if (button.enabled) regions.push({ rect: r, action: button.id });
}

function drawSeat(ctx: Canvas2D, seat: SeatScreen, center: { x: number; y: number }, scale: number): void {
  const radius = 15 * scale;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = seat.team === 0 ? '#1f3b46' : '#40361f';
  ctx.fill();
  ctx.lineWidth = seat.active ? 2.5 : 1;
  ctx.strokeStyle = seat.active ? COLOR.mint : COLOR.panelEdge;
  ctx.stroke();
  text(ctx, seat.position === 'top' ? '搭' : 'AI', center.x, center.y, 11 * scale, seat.team === 0 ? COLOR.blue : COLOR.gold, 'center', 700);
  const tags = [`${seat.remaining} 张`];
  if (seat.report !== null) tags.push(`报${seat.report}`);
  if (seat.place !== null) tags.push(`第${seat.place}`);
  const tagColor = seat.report !== null ? COLOR.red : COLOR.muted;
  if (seat.position === 'top') {
    // The partner sits in a slim row above the table: avatar, then name and counts to its right.
    text(ctx, seat.name, center.x + radius + 8 * scale, center.y, 12 * scale, COLOR.ink, 'left', 600);
    text(ctx, tags.join(' · '), center.x + radius + 44 * scale, center.y, 11 * scale, tagColor, 'left');
    return;
  }
  const below = center.y + radius + 10 * scale;
  text(ctx, seat.name, center.x, below, 12 * scale, COLOR.ink, 'center', 600);
  text(ctx, tags.join(' · '), center.x, below + 15 * scale, 11 * scale, tagColor, 'center');
}

function panel(ctx: Canvas2D, r: Rect): void {
  roundRect(ctx, r, 12);
  ctx.fillStyle = COLOR.panel;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.stroke();
}

function drawStart(ctx: Canvas2D, view: Viewport, screen: TableScreen, regions: HitRegion[]): void {
  const start = screen.start!;
  const w = Math.min(420, view.width - view.insetLeft - view.insetRight - 32);
  const h = Math.min(300, view.height - view.insetTop - view.insetBottom - 16);
  const r = { x: (view.width - w) / 2, y: (view.height - h) / 2, w, h };
  panel(ctx, r);
  const pad = 22;
  text(ctx, '4A4', r.x + pad, r.y + 34, 30, COLOR.ink, 'left', 700);
  text(ctx, '四人两队 · 和三位 AI 打一局', r.x + pad + 72, r.y + 36, 13, COLOR.muted);
  const optionY = r.y + 70;
  const optionW = (w - pad * 2 - 10) / 2;
  DECK_OPTIONS.forEach((option, index) => {
    const box = { x: r.x + pad + index * (optionW + 10), y: optionY, w: optionW, h: 64 };
    roundRect(ctx, box, 9);
    const chosen = option.deckCount === start.deckCount;
    ctx.fillStyle = chosen ? '#1f3a30' : COLOR.bg;
    ctx.fill();
    ctx.lineWidth = chosen ? 2 : 1;
    ctx.strokeStyle = chosen ? COLOR.mint : COLOR.panelEdge;
    ctx.stroke();
    text(ctx, option.label, box.x + 14, box.y + 22, 16, COLOR.ink, 'left', 700);
    text(ctx, fit(ctx, option.summary, 11, box.w - 24), box.x + 14, box.y + 45, 11, COLOR.muted);
    regions.push({ rect: box, action: option.deckCount === 1 ? 'deck-1' : 'deck-2' });
  });
  const buttonH = 44;
  drawButton(ctx, { id: 'start', label: '开始游戏', enabled: true, style: 'primary' },
    { x: r.x + pad, y: r.y + h - pad - buttonH, w: w - pad * 2 - 56, h: buttonH }, regions);
  drawButton(ctx, { id: 'help', label: '规则', enabled: true, style: 'quiet' },
    { x: r.x + w - pad - 48, y: r.y + h - pad - buttonH, w: 48, h: buttonH }, regions);
  text(ctx, fit(ctx, `${start.summary} · 持红桃 3 的玩家先出`, 11, w - pad * 2), r.x + pad, optionY + 86, 11, COLOR.muted);
}

function drawResult(ctx: Canvas2D, view: Viewport, screen: TableScreen, regions: HitRegion[]): void {
  const result = screen.result!;
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, view.width, view.height);
  const w = Math.min(380, view.width - 48);
  const h = Math.min(290, view.height - view.insetTop - view.insetBottom - 16);
  const r = { x: (view.width - w) / 2, y: (view.height - h) / 2, w, h };
  panel(ctx, r);
  text(ctx, result.title, r.x + 22, r.y + 32, 22, COLOR.ink, 'left', 700);
  text(ctx, fit(ctx, result.subtitle, 12, w - 44), r.x + 22, r.y + 58, 12, COLOR.muted);
  const rowH = Math.min(30, (h - 150) / 4);
  result.places.forEach((place, index) => {
    const y = r.y + 82 + index * rowH + rowH / 2;
    text(ctx, `第 ${index + 1} 名`, r.x + 22, y, 13, COLOR.muted);
    text(ctx, place.name, r.x + 90, y, 14, COLOR.ink, 'left', 600);
    text(ctx, place.winning ? '胜方' : '', r.x + w - 22, y, 12, COLOR.mint, 'right');
  });
  const buttonW = (w - 54) / 2;
  drawButton(ctx, { id: 'replay', label: '同种子重开', enabled: true, style: 'secondary' },
    { x: r.x + 22, y: r.y + h - 62, w: buttonW, h: 42 }, regions);
  drawButton(ctx, { id: 'new-game', label: '新开一局', enabled: true, style: 'primary' },
    { x: r.x + 32 + buttonW, y: r.y + h - 62, w: buttonW, h: 42 }, regions);
}

const HELP_TEXT = [
  '四人两队：你和对面的搭档一队。两副牌每人 27 张；一副牌 54 张，每队一人 14 张、一人 13 张。持红桃 3 的玩家先出。',
  '牌型：单张、对子、单/双/三顺、轰（3 张）/炸弹、王炸、4A4（两张 4 加一张 A，最大）。',
  '轮流严格压牌或不出；其他人都不要时，最后压住的人接着出，他已出完就由搭档借光。',
  '勾岔：单牌可被别人用同点数对子“岔”，岔后才能用同点数单张“勾”，岔勾交替。有人岔过后链条一停，这一轮立刻结束（死岔/死勾），谁也不能再压，最后岔或勾的人接着出。',
  '只剩一人有牌时结算：第一名所在队获胜，搭档之后出完的对手人数就是抓的人数。',
].join('\n');

function drawHelp(ctx: Canvas2D, view: Viewport, regions: HitRegion[]): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, view.width, view.height);
  const w = Math.min(560, view.width - view.insetLeft - view.insetRight - 32);
  const h = view.height - view.insetTop - view.insetBottom - 24;
  const r = { x: (view.width - w) / 2, y: (view.height - h) / 2, w, h };
  panel(ctx, r);
  text(ctx, '规则速览', r.x + 20, r.y + 24, 17, COLOR.ink, 'left', 700);
  const size = h < 320 ? 11 : 13;
  const lines = wrap(ctx, HELP_TEXT, size, w - 40);
  lines.forEach((line, index) => text(ctx, line, r.x + 20, r.y + 50 + index * (size + 6), size, COLOR.muted));
  text(ctx, '点任意处关闭', r.x + w - 20, r.y + 24, 11, COLOR.muted, 'right');
  regions.push({ rect: { x: 0, y: 0, w: view.width, h: view.height }, action: 'close-help' });
}

/** Lay out and draw one frame; returns the tappable regions, topmost last. */
export function drawFrame(ctx: Canvas2D, view: Viewport, screen: TableScreen, overlay: Overlay): HitRegion[] {
  const regions: HitRegion[] = [];
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, view.width, view.height);

  const left = view.insetLeft + 10;
  const right = view.width - view.insetRight - 10;
  const top = view.insetTop + 6;
  const bottom = view.height - view.insetBottom - 6;
  const scale = Math.max(0.8, Math.min(1.25, view.height / 390));

  // Top bar: version on the left, seed and buttons on the right.
  const barH = 26 * scale;
  text(ctx, screen.topLabel, left, top + barH / 2, 13 * scale, COLOR.ink, 'left', 700);
  const smallButtonW = 52 * scale;
  drawButton(ctx, { id: 'help', label: '规则', enabled: true, style: 'quiet' },
    { x: right - smallButtonW * 2 - 6, y: top, w: smallButtonW, h: barH }, regions);
  drawButton(ctx, { id: 'new-game', label: '新局', enabled: screen.start === null, style: 'quiet' },
    { x: right - smallButtonW, y: top, w: smallButtonW, h: barH }, regions);
  text(ctx, screen.seedLabel, right - smallButtonW * 2 - 14, top + barH / 2, 11 * scale, COLOR.muted, 'right');

  // Hand along the bottom.
  const cardH = Math.min(96, Math.max(54, view.height * 0.23));
  const cardW = cardH * 0.68;
  const raise = cardH * 0.2;
  const handTop = bottom - cardH;
  const cards = screen.hand.cards;
  const handWidth = right - left;
  const step = cards.length <= 1 ? 0 : Math.min(cardW * 0.62, (handWidth - cardW) / (cards.length - 1));
  const handStart = left + Math.max(0, (handWidth - (step * Math.max(0, cards.length - 1) + cardW)) / 2);
  cards.forEach((card, index) => {
    const selected = screen.hand.selected.has(card.id);
    const x = handStart + index * step;
    const r = { x, y: handTop - (selected ? raise : 0), w: cardW, h: cardH };
    const dimmed = screen.hand.eligible !== null && !screen.hand.eligible.has(card.id);
    drawCard(ctx, card, r, { selected, dimmed, showCopy: screen.showCopy });
    if (screen.hand.enabled && !dimmed) {
      const isLast = index === cards.length - 1;
      regions.push({ cardId: card.id, rect: { x, y: handTop - raise, w: isLast ? cardW : step, h: cardH + raise } });
    }
  });

  // Controls row above the hand: caption and error on the left, buttons on the right.
  const rowH = 34 * scale;
  const rowY = handTop - raise - 8 - rowH;
  const buttonW = 66 * scale;
  screen.buttons.forEach((button, index) => {
    const x = right - (screen.buttons.length - index) * (buttonW + 6) + 6;
    drawButton(ctx, button, { x, y: rowY, w: buttonW, h: rowH }, regions);
  });
  const captionMax = right - left - screen.buttons.length * (buttonW + 6) - 10;
  if (screen.start === null) {
    text(ctx, fit(ctx, screen.caption, 12 * scale, captionMax), left, rowY + rowH * 0.3, 12 * scale, COLOR.muted);
    if (screen.error) text(ctx, fit(ctx, screen.error, 12 * scale, captionMax), left, rowY + rowH * 0.78, 12 * scale, COLOR.red);
  }

  // Seats: partner in a row above the table, opponents left and right of it.
  const partnerY = top + barH + 18 * scale;
  const tableTop = partnerY + 18 * scale;
  const tableBottom = rowY - 6;
  const sideX = 46 * scale;
  for (const seat of screen.seats) {
    if (seat.position === 'bottom') continue;
    const center = seat.position === 'top'
      ? { x: view.width / 2 - 60 * scale, y: partnerY }
      : { x: seat.position === 'left' ? left + sideX : right - sideX, y: (tableTop + tableBottom) / 2 - 14 * scale };
    drawSeat(ctx, seat, center, seat.position === 'top' ? scale * 0.8 : scale);
  }

  // Table felt in the middle.
  const feltX = left + sideX * 2 + 8;
  const felt = { x: feltX, y: tableTop, w: right - sideX * 2 - 8 - feltX, h: tableBottom - tableTop };
  roundRect(ctx, felt, 18);
  ctx.fillStyle = COLOR.felt;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR.feltEdge;
  ctx.stroke();
  const cx = felt.x + felt.w / 2;
  text(ctx, fit(ctx, screen.center.headline, 15 * scale, felt.w - 24, 700), cx, felt.y + 16 * scale, 15 * scale, COLOR.ink, 'center', 700);
  const tableCards = screen.center.cards;
  const smallH = Math.min(felt.h * 0.42, cardH * 0.82);
  const smallW = smallH * 0.68;
  if (tableCards.length > 0) {
    const tStep = tableCards.length <= 1 ? 0 : Math.min(smallW * 0.7, (felt.w - 40 - smallW) / (tableCards.length - 1));
    const total = tStep * (tableCards.length - 1) + smallW;
    tableCards.forEach((card, index) => drawCard(ctx, card,
      { x: cx - total / 2 + index * tStep, y: felt.y + 30 * scale, w: smallW, h: smallH }, { showCopy: screen.showCopy }));
  } else {
    text(ctx, '4A4', cx, felt.y + 30 * scale + smallH / 2, smallH * 0.45, 'rgba(237,242,232,0.12)', 'center', 700);
  }
  const lineY = felt.y + 30 * scale + smallH + 13 * scale;
  text(ctx, fit(ctx, [screen.center.holderLine, screen.center.detail].filter(Boolean).join(' · '), 11 * scale, felt.w - 24),
    cx, lineY, 11 * scale, COLOR.muted, 'center');
  const statusY = Math.min(felt.y + felt.h - 14 * scale, lineY + 20 * scale);
  text(ctx, fit(ctx, screen.status.text, 13 * scale, felt.w - 24, 600), cx, statusY, 13 * scale,
    screen.status.forHuman ? COLOR.mint : COLOR.ink, 'center', 600);
  if (screen.history.length > 0 && felt.h > 150 * scale) {
    text(ctx, fit(ctx, `最近：${screen.history.join(' · ')}`, 10 * scale, felt.w - 24), cx, felt.y + felt.h - 10 * scale,
      10 * scale, COLOR.muted, 'center');
  }

  if (overlay.notice) {
    const w = Math.min(320, view.width - 40);
    const r = { x: (view.width - w) / 2, y: tableTop + 8, w, h: 30 };
    roundRect(ctx, r, 15);
    ctx.fillStyle = '#2a3b35';
    ctx.fill();
    text(ctx, fit(ctx, overlay.notice, 12, w - 20), view.width / 2, r.y + 15, 12, COLOR.ink, 'center');
  }

  if (screen.start !== null) {
    ctx.fillStyle = COLOR.scrim;
    ctx.fillRect(0, 0, view.width, view.height);
    regions.length = 0;
    drawStart(ctx, view, screen, regions);
  } else if (screen.result !== null) {
    regions.length = 0;
    drawResult(ctx, view, screen, regions);
  }
  if (overlay.help) {
    regions.length = 0;
    drawHelp(ctx, view, regions);
  }
  return regions;
}

/** The topmost region under a tap, if any. */
export function hitTest(regions: readonly HitRegion[], x: number, y: number): HitRegion | null {
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index]!;
    const r = region.rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return region;
  }
  return null;
}
