import { Card, Rank } from '../../client/assets/scripts/core/cards/card';
import { DECK_OPTIONS, PLAYER_OPTIONS } from '../../client/assets/scripts/ui/deck-options';
import { SUIT_GLYPH, isRedCard, rankLabel } from '../../client/assets/scripts/ui/labels';
import { ActionId, ButtonScreen, LobbyScreen, SeatPosition, SeatScreen, TableScreen, ZoneScreen } from './screen';

/**
 * Canvas drawing for the mini game, in the "classic card room" look shared with the web version: bright felt,
 * round avatars, each seat's play in front of it, big warm buttons above the hand.
 */

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

/** The subset of the 2D canvas API used here; WeChat's canvas context and the browser's both provide it. */
export interface Canvas2D {
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
  textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic' | 'hanging' | 'ideographic';
  globalAlpha: number;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike;
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
  /** A hand card; `column` is set when the hand sits in rank columns. */
  | { readonly rect: Rect; readonly cardId: string; readonly column?: number };

/** Effects in flight, as progress from 0 (just started) to 1 (done). */
export interface Effects {
  readonly zones?: Partial<Record<SeatPosition, number>>;
  readonly flash?: { readonly text: string; readonly progress: number } | null;
}

export interface Overlay {
  readonly help: boolean;
  readonly notice: string;
  readonly effects?: Effects;
}

const COLOR = {
  feltLight: '#38ad72',
  felt: '#1f8450',
  feltDark: '#0f5636',
  ink: '#ffffff',
  inkSoft: 'rgba(255,255,255,0.8)',
  gold: '#ffd451',
  goldDeep: '#ff9f1a',
  goldShadow: '#b86a00',
  blue: '#3d8ee8',
  blueShadow: '#1b4f99',
  white: '#f6faf7',
  whiteShadow: '#94ad9f',
  greenInk: '#1d5a3b',
  red: '#e5483f',
  team0: '#2f7fd8',
  team1: '#c98a1c',
  team2: '#8a4cc0',
  team3: '#c5483b',
  cardFace: '#fffdf6',
  cardInk: '#1c1f1d',
  cardRed: '#d0322b',
  chip: 'rgba(0,0,0,0.28)',
  panel: '#fff8e8',
  panelInk: '#23412f',
  panelMuted: '#5f7567',
  panelLine: '#e2d6b8',
  scrim: 'rgba(0,25,14,0.62)',
} as const;

const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';

/** Avatar colour per team: blue and gold for the two teams of four, a colour each when playing alone. */
const TEAM_COLORS: readonly string[] = [COLOR.team0, COLOR.team1, COLOR.team2, COLOR.team3];

function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${FONT}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
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

function fillRound(ctx: Canvas2D, r: Rect, radius: number, color: string): void {
  roundRect(ctx, r, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function text(ctx: Canvas2D, value: string, x: number, y: number, size: number, color: string,
  align: Canvas2D['textAlign'] = 'left', weight = 400): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

function textWidth(ctx: Canvas2D, value: string, size: number, weight = 400): number {
  ctx.font = font(size, weight);
  return ctx.measureText(value).width;
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
  const h = r.h;
  if (h >= 50) fillRound(ctx, { x: r.x + 1, y: r.y + 2, w: r.w, h: r.h }, h * 0.08, 'rgba(0,0,0,0.22)');
  roundRect(ctx, r, h * 0.08);
  ctx.fillStyle = options.selected ? '#fff6d8' : COLOR.cardFace;
  ctx.fill();
  ctx.lineWidth = options.selected ? 2 : 1;
  ctx.strokeStyle = options.selected ? COLOR.goldDeep : 'rgba(0,0,0,0.25)';
  ctx.stroke();
  const ink = isRedCard(card) ? COLOR.cardRed : COLOR.cardInk;
  const left = r.x + h * 0.06;
  const joker = card.rank === Rank.SMALL_JOKER || card.rank === Rank.BIG_JOKER;
  if (joker) {
    const size = h * 0.17;
    text(ctx, card.rank === Rank.BIG_JOKER ? '大' : '小', left + size / 2, r.y + h * 0.04 + size * 0.6, size, ink, 'center', 800);
    text(ctx, '王', left + size / 2, r.y + h * 0.04 + size * 1.7, size, ink, 'center', 800);
    text(ctx, '★', r.x + r.w - h * 0.2, r.y + h * 0.8, h * 0.3, ink, 'center');
  } else {
    const rankSize = h * 0.25;
    text(ctx, rankLabel(card.rank), left + rankSize * 0.4, r.y + h * 0.04 + rankSize * 0.55, rankSize, ink, 'center', 900);
    text(ctx, SUIT_GLYPH[card.suit], left + rankSize * 0.4, r.y + h * 0.04 + rankSize * 1.35, h * 0.17, ink, 'center');
    if (r.w > h * 0.5) text(ctx, SUIT_GLYPH[card.suit], r.x + r.w - h * 0.2, r.y + h * 0.78, h * 0.34, ink, 'center');
  }
  if (options.showCopy && h >= 56) {
    text(ctx, card.deckIndex === 0 ? 'Ⅰ' : 'Ⅱ', left, r.y + h - h * 0.07, h * 0.09, 'rgba(0,0,0,0.35)', 'left');
  }
  if (options.dimmed) fillRound(ctx, r, h * 0.08, 'rgba(10,30,20,0.5)');
}

const BUTTON_COLORS: Readonly<Record<ButtonScreen['style'], { fill: string; shadow: string; ink: string }>> = {
  primary: { fill: COLOR.gold, shadow: COLOR.goldShadow, ink: '#5a2a00' },
  secondary: { fill: COLOR.blue, shadow: COLOR.blueShadow, ink: '#ffffff' },
  quiet: { fill: COLOR.white, shadow: COLOR.whiteShadow, ink: COLOR.greenInk },
};

/** A big game button: a pill with a darker edge below. */
function drawButton(ctx: Canvas2D, button: ButtonScreen, r: Rect, regions: HitRegion[]): void {
  const colors = BUTTON_COLORS[button.style];
  ctx.globalAlpha = button.enabled ? 1 : 0.45;
  const edge = Math.max(2, r.h * 0.08);
  fillRound(ctx, { x: r.x, y: r.y + edge, w: r.w, h: r.h }, r.h / 2, colors.shadow);
  fillRound(ctx, r, r.h / 2, colors.fill);
  text(ctx, fit(ctx, button.label, r.h * 0.4, r.w - 12, 800), r.x + r.w / 2, r.y + r.h / 2, r.h * 0.4, colors.ink, 'center', 800);
  ctx.globalAlpha = 1;
  if (button.enabled) regions.push({ rect: { x: r.x, y: r.y, w: r.w, h: r.h + edge }, action: button.id });
}

/** A small pill in the top bar. */
function drawChip(ctx: Canvas2D, button: ButtonScreen, r: Rect, regions: HitRegion[]): void {
  ctx.globalAlpha = button.enabled ? 1 : 0.45;
  fillRound(ctx, r, r.h / 2, button.style === 'primary' ? COLOR.gold : COLOR.chip);
  text(ctx, button.label, r.x + r.w / 2, r.y + r.h / 2, Math.min(13, r.h * 0.46), button.style === 'primary' ? '#5a2a00' : COLOR.ink, 'center', 700);
  ctx.globalAlpha = 1;
  if (button.enabled) regions.push({ rect: r, action: button.id });
}

function chipWidth(ctx: Canvas2D, button: ButtonScreen, h: number): number {
  return textWidth(ctx, button.label, Math.min(13, h * 0.46), 700) + h * 0.9;
}

function drawLogo(ctx: Canvas2D, x: number, y: number, size: number, dark = false): number {
  const base = dark ? '#1d6a43' : COLOR.ink;
  const w4 = textWidth(ctx, '4', size, 900);
  const wA = textWidth(ctx, 'A', size, 900);
  text(ctx, '4', x, y, size, base, 'left', 900);
  text(ctx, 'A', x + w4, y, size, dark ? COLOR.goldDeep : COLOR.gold, 'left', 900);
  text(ctx, '4', x + w4 + wA, y, size, base, 'left', 900);
  return w4 * 2 + wA;
}

function drawFelt(ctx: Canvas2D, view: Viewport): void {
  const gradient = ctx.createRadialGradient(view.width / 2, view.height * 0.4, 0, view.width / 2, view.height * 0.4, Math.max(view.width, view.height) * 0.7);
  gradient.addColorStop(0, COLOR.feltLight);
  gradient.addColorStop(0.5, COLOR.felt);
  gradient.addColorStop(1, COLOR.feltDark);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.width, view.height);
}

interface SeatLayout { readonly x: number; readonly y: number; readonly r: number }

function drawSeat(ctx: Canvas2D, seat: SeatScreen, at: SeatLayout, scale: number): void {
  const { x, y, r } = at;
  if (seat.place !== null) ctx.globalAlpha = 0.65;
  if (seat.active) {
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,212,81,0.45)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = TEAM_COLORS[seat.team] ?? COLOR.team0;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = seat.active ? COLOR.gold : 'rgba(255,255,255,0.85)';
  ctx.stroke();
  text(ctx, seat.badge, x, y + 1, r * (seat.badge.length > 1 ? 0.62 : 0.85), COLOR.ink, 'center', 900);
  const nameSize = 12 * scale;
  const countSize = 13 * scale;
  const count = `${seat.remaining}`;
  const tags: { label: string; color: string; ink: string }[] = [];
  if (seat.report !== null && seat.place === null) tags.push({ label: `报${seat.report}`, color: COLOR.red, ink: '#ffffff' });
  if (seat.place !== null) tags.push({ label: `第${seat.place}名`, color: COLOR.gold, ink: '#5a2a00' });
  const drawCount = (cx: number, cy: number, align: 'left' | 'center') => {
    const backW = 9 * scale;
    const total = backW + 4 + textWidth(ctx, count, countSize, 900);
    const startX = align === 'center' ? cx - total / 2 : cx;
    fillRound(ctx, { x: startX, y: cy - 6.5 * scale, w: backW, h: 13 * scale }, 2, '#b23030');
    text(ctx, count, startX + backW + 4, cy, countSize, COLOR.gold, 'left', 900);
    return startX + total;
  };
  const drawTag = (tx: number, ty: number, tag: { label: string; color: string; ink: string }) => {
    const w = textWidth(ctx, tag.label, 10 * scale, 900) + 10;
    fillRound(ctx, { x: tx, y: ty - 8 * scale, w, h: 16 * scale }, 8 * scale, tag.color);
    text(ctx, tag.label, tx + w / 2, ty, 10 * scale, tag.ink, 'center', 900);
    return w;
  };
  if (seat.position === 'top') {
    const tx = x + r + 8;
    text(ctx, seat.name, tx, y - 8 * scale, nameSize, COLOR.ink, 'left', 800);
    const end = drawCount(tx, y + 9 * scale, 'left');
    if (tags[0] !== undefined) drawTag(end + 6, y + 9 * scale, tags[0]);
  } else {
    text(ctx, fit(ctx, seat.name, nameSize, r * 2 + 36, 800), x, y + r + 11 * scale, nameSize, COLOR.ink, 'center', 800);
    drawCount(x, y + r + 27 * scale, 'center');
    if (tags[0] !== undefined) {
      const w = textWidth(ctx, tags[0].label, 10 * scale, 900) + 10;
      drawTag(x - w / 2, y + r + 43 * scale, tags[0]);
    }
  }
  ctx.globalAlpha = 1;
}

/** One seat's latest action; `anchor` says which edge of the zone sits at (x, y). */
function drawZone(ctx: Canvas2D, zone: ZoneScreen, x: number, y: number, anchor: 'center' | 'left' | 'right',
  miniH: number, scale: number, progress: number, from: { dx: number; dy: number }, showCopy: boolean, row: boolean): void {
  const eased = 1 - (1 - progress) ** 3;
  ctx.save();
  ctx.globalAlpha = Math.min(1, progress * 1.6);
  ctx.translate((1 - eased) * from.dx, (1 - eased) * from.dy);
  if (zone.kind === 'PASS') {
    const size = 15 * scale;
    const w = textWidth(ctx, '不出', size, 900) + 26;
    const h = size + 14;
    const left = anchor === 'center' ? x - w / 2 : anchor === 'left' ? x : x - w;
    fillRound(ctx, { x: left + 1, y: y - h / 2 + 2, w, h }, h / 2, 'rgba(0,0,0,0.2)');
    fillRound(ctx, { x: left, y: y - h / 2, w, h }, h / 2, '#ffffff');
    text(ctx, '不出', left + w / 2, y, size, '#3c6fa8', 'center', 900);
    ctx.restore();
    return;
  }
  const miniW = miniH * 0.7;
  const step = miniW * 0.45;
  const cardsW = miniW + step * Math.max(0, zone.cards.length - 1);
  const labelSize = 11 * scale;
  const label = zone.kind === 'PLAY' ? zone.label : `${zone.label}！`;
  const labelW = textWidth(ctx, label, labelSize, 800) + 16 + (zone.leading ? 30 * scale : 0);
  const labelH = labelSize + 8;
  // Cards with the label under them, or beside them on a short screen.
  const blockW = row ? cardsW + 8 + labelW : Math.max(cardsW, labelW);
  const left = anchor === 'center' ? x - blockW / 2 : anchor === 'left' ? x : x - blockW;
  const cardsX = row ? left : left + (blockW - cardsW) / 2;
  const cardsY = row ? y - miniH / 2 : y - (miniH + 4 + labelH) / 2;
  if (zone.leading || zone.bomb) {
    roundRect(ctx, { x: cardsX - 4, y: cardsY - 4, w: cardsW + 8, h: miniH + 8 }, 8);
    ctx.lineWidth = zone.bomb ? 3 : 2;
    ctx.strokeStyle = COLOR.gold;
    ctx.stroke();
  }
  zone.cards.forEach((card, index) => drawCard(ctx, card, { x: cardsX + index * step, y: cardsY, w: miniW, h: miniH }, { showCopy }));
  const labelX = row ? cardsX + cardsW + 8 : left + (blockW - labelW) / 2;
  const labelY = row ? y - labelH / 2 : cardsY + miniH + 4;
  const warm = zone.bomb || zone.kind !== 'PLAY';
  fillRound(ctx, { x: labelX, y: labelY, w: labelW, h: labelH }, labelH / 2, warm ? COLOR.gold : 'rgba(0,0,0,0.38)');
  text(ctx, label, labelX + 8, labelY + labelH / 2, labelSize, warm ? '#5a2a00' : COLOR.ink, 'left', 800);
  if (zone.leading) {
    const tagX = labelX + labelW - 8 - 26 * scale;
    fillRound(ctx, { x: tagX, y: labelY + 3, w: 26 * scale, h: labelH - 6 }, (labelH - 6) / 2, COLOR.gold);
    text(ctx, '最大', tagX + 13 * scale, labelY + labelH / 2, 9 * scale, '#5a2a00', 'center', 900);
  }
  ctx.restore();
}

function panel(ctx: Canvas2D, r: Rect): void {
  fillRound(ctx, { x: r.x + 2, y: r.y + 5, w: r.w, h: r.h }, 18, 'rgba(0,0,0,0.3)');
  roundRect(ctx, r, 18);
  ctx.fillStyle = COLOR.panel;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.gold;
  ctx.stroke();
}

function scrim(ctx: Canvas2D, view: Viewport): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, view.width, view.height);
}

function drawStart(ctx: Canvas2D, view: Viewport, screen: TableScreen, regions: HitRegion[]): void {
  const start = screen.start!;
  const w = Math.min(560, view.width - view.insetLeft - view.insetRight - 32);
  const h = Math.min(290, view.height - view.insetTop - view.insetBottom - 16);
  const r = { x: (view.width - w) / 2, y: (view.height - h) / 2, w, h };
  panel(ctx, r);
  const pad = 22;
  const logoW = drawLogo(ctx, r.x + pad, r.y + 38, 34, true);
  text(ctx, fit(ctx, start.online ? '单人练习或和好友联机' : '和 AI 打一局', 13, w - pad * 2 - logoW - 14),
    r.x + pad + logoW + 14, r.y + 40, 13, COLOR.panelMuted);
  const option = (box: Rect, label: string, chosen: boolean, action: ActionId) => {
    roundRect(ctx, box, 12);
    ctx.fillStyle = chosen ? '#fff0c4' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = chosen ? COLOR.goldDeep : COLOR.panelLine;
    ctx.stroke();
    text(ctx, label, box.x + box.w / 2, box.y + box.h / 2, 15, COLOR.panelInk, 'center', 800);
    regions.push({ rect: box, action });
  };
  // Table size, then (four players only) one deck or two.
  const rowH = 38;
  const playersY = r.y + 66;
  const playerW = (w - pad * 2 - 20) / 3;
  PLAYER_OPTIONS.forEach((choice, index) => option(
    { x: r.x + pad + index * (playerW + 10), y: playersY, w: playerW, h: rowH },
    choice.playerCount === 4 ? '4 人 · 两队' : `${choice.playerCount} 人 · 各打各`, choice.playerCount === start.playerCount, `players-${choice.playerCount}`));
  const decksY = playersY + rowH + 10;
  if (start.playerCount === 4) {
    const deckW = (w - pad * 2 - 10) / 2;
    DECK_OPTIONS.forEach((choice, index) => option(
      { x: r.x + pad + index * (deckW + 10), y: decksY, w: deckW, h: rowH },
      choice.label, choice.deckCount === start.deckCount, choice.deckCount === 1 ? 'deck-1' : 'deck-2'));
  }
  text(ctx, fit(ctx, start.summary, 11, w - pad * 2), r.x + pad, (start.playerCount === 4 ? decksY + rowH : decksY) + 14, 11, COLOR.panelMuted);
  const buttonH = 42;
  const buttonY = r.y + h - pad - buttonH - 4;
  const rowButtons: ButtonScreen[] = [
    { id: 'start', label: start.online ? '单人练习' : '开始游戏', enabled: true, style: 'primary' },
    ...(start.online ? [
      { id: 'create-room', label: '创建房间', enabled: true, style: 'secondary' } as const,
      { id: 'join-room', label: '加入房间', enabled: true, style: 'secondary' } as const,
    ] : []),
  ];
  const helpW = 64;
  const gap = 10;
  const rowW = (w - pad * 2 - helpW - gap * rowButtons.length) / rowButtons.length;
  rowButtons.forEach((button, index) => drawButton(ctx, button,
    { x: r.x + pad + index * (rowW + gap), y: buttonY, w: rowW, h: buttonH }, regions));
  drawButton(ctx, { id: 'help', label: '规则', enabled: true, style: 'quiet' },
    { x: r.x + w - pad - helpW, y: buttonY, w: helpW, h: buttonH }, regions);
}

function drawResult(ctx: Canvas2D, view: Viewport, screen: TableScreen, regions: HitRegion[]): void {
  const result = screen.result!;
  scrim(ctx, view);
  const w = Math.min(460, view.width - 48);
  const h = Math.min(300, view.height - view.insetTop - view.insetBottom - 24);
  const r = { x: (view.width - w) / 2, y: (view.height - h) / 2 + 8, w, h };
  panel(ctx, r);
  const won = result.title.startsWith('你们') || result.title.startsWith('蓝队');
  const ribbonW = 110;
  fillRound(ctx, { x: r.x + (w - ribbonW) / 2, y: r.y - 16, w: ribbonW, h: 32 }, 16, won ? COLOR.goldDeep : '#7d97b0');
  text(ctx, won ? '胜 利' : '惜 败', r.x + w / 2, r.y, 16, won ? '#5a2a00' : '#ffffff', 'center', 900);
  text(ctx, result.title, r.x + w / 2, r.y + 38, 21, COLOR.panelInk, 'center', 900);
  text(ctx, fit(ctx, result.subtitle, 12, w - 44), r.x + w / 2, r.y + 62, 12, COLOR.panelMuted, 'center');
  const cellW = (w - 44 - 8) / 2;
  const cellH = Math.min(32, (h - 160) / 2);
  result.places.forEach((place, index) => {
    const cell = { x: r.x + 22 + (index % 2) * (cellW + 8), y: r.y + 80 + Math.floor(index / 2) * (cellH + 6), w: cellW, h: cellH };
    fillRound(ctx, cell, 10, place.winning ? '#fff0c2' : '#f0eadb');
    text(ctx, `第 ${index + 1} 名`, cell.x + 12, cell.y + cellH / 2, 13, '#8a6a20', 'left', 800);
    text(ctx, fit(ctx, place.name, 13, cellW - 80, 800), cell.x + cellW - 12, cell.y + cellH / 2, 13, COLOR.panelInk, 'right', 800);
  });
  if (result.note) text(ctx, fit(ctx, result.note, 12, w - 44), r.x + w / 2, r.y + h - 76, 12, COLOR.panelMuted, 'center');
  const count = Math.max(1, result.buttons.length);
  const buttonW = Math.min(150, (w - 44 - (count - 1) * 12) / count);
  const totalW = count * buttonW + (count - 1) * 12;
  result.buttons.forEach((button, index) => drawButton(ctx, button,
    { x: r.x + (w - totalW) / 2 + index * (buttonW + 12), y: r.y + h - 58, w: buttonW, h: 40 }, regions));
}

const HELP_TEXT = [
  '队伍：四人两队，你和对面的搭档一队。两副牌每人 27 张；一副牌 54 张，每队一人 14 张、一人 13 张。持红桃 3 的玩家先出。',
  '牌型：单张、对子、单/双/三顺、轰（3 张）/炸弹（4 张以上）、王炸、4A4（两张 4 加一张 A，最大）。',
  '出牌：轮流压过上一手或不出；其他人都不要时，最后压住的人接着出，他已出完就由搭档借光。',
  '勾岔：单牌可被别人用同点数对子“岔”，岔后才能用同点数单张“勾”，岔勾交替。有人岔过后链条一停，这一轮立刻结束，最后岔或勾的人接着出。',
  '结算：第一个出完的人那队获胜，搭档之后出完的对手越少，抓的人越多。只剩一人有牌、或一队两人都出完时立刻结束。',
  '操作：点牌选择，按住横着滑可以一次选一串；两副牌时手牌按点数竖排，滑过哪张选哪张。',
].join('\n');

function drawHelp(ctx: Canvas2D, view: Viewport, regions: HitRegion[]): void {
  scrim(ctx, view);
  const w = Math.min(620, view.width - view.insetLeft - view.insetRight - 32);
  const h = view.height - view.insetTop - view.insetBottom - 24;
  const r = { x: (view.width - w) / 2, y: (view.height - h) / 2, w, h };
  panel(ctx, r);
  text(ctx, '规则速览', r.x + 20, r.y + 24, 18, COLOR.panelInk, 'left', 900);
  text(ctx, '点任意处关闭', r.x + w - 20, r.y + 24, 11, COLOR.panelMuted, 'right');
  let size = h < 320 ? 12 : 14;
  let lines = wrap(ctx, HELP_TEXT, size, w - 40);
  // Shrink until the rules fit the panel.
  while (size > 9 && 50 + lines.length * (size + 6) > h - 10) {
    size -= 1;
    lines = wrap(ctx, HELP_TEXT, size, w - 40);
  }
  lines.forEach((line, index) => text(ctx, line, r.x + 20, r.y + 50 + index * (size + 6), size, COLOR.panelInk));
  regions.push({ rect: { x: 0, y: 0, w: view.width, h: view.height }, action: 'close-help' });
}

function drawNotice(ctx: Canvas2D, view: Viewport, notice: string, y: number): void {
  const w = Math.min(textWidth(ctx, notice, 13, 700) + 36, view.width - 40);
  const r = { x: (view.width - w) / 2, y, w, h: 30 };
  fillRound(ctx, r, 15, 'rgba(0,0,0,0.75)');
  text(ctx, fit(ctx, notice, 13, w - 20, 700), view.width / 2, r.y + 15, 13, COLOR.ink, 'center', 700);
}

/** Card sizes and the hand layout for a screen. */
function handMetrics(view: Viewport, screen: TableScreen) {
  const cardH = clamp(view.height * 0.19, 56, 124);
  const cardW = cardH * 0.7;
  const columns: Card[][] = [];
  if (screen.handColumns) {
    for (const card of screen.hand.cards) {
      const last = columns[columns.length - 1];
      if (last !== undefined && last[0]!.rank === card.rank) last.push(card);
      else columns.push([card]);
    }
  }
  const tallest = Math.max(1, ...columns.map((column) => column.length));
  const strip = Math.min(cardH * 0.3, (cardH * 0.95) / Math.max(1, tallest - 1));
  const lift = cardH * 0.18;
  const height = screen.handColumns ? cardH + (tallest - 1) * strip + 8 : cardH + lift;
  return { cardH, cardW, columns, strip, lift, height };
}

/** Lay out and draw one frame; returns the tappable regions, topmost last. */
export function drawFrame(ctx: Canvas2D, view: Viewport, screen: TableScreen, overlay: Overlay): HitRegion[] {
  const regions: HitRegion[] = [];
  drawFelt(ctx, view);

  const left = view.insetLeft + 10;
  const right = view.width - view.insetRight - 10;
  const top = view.insetTop + 4;
  const bottom = view.height - view.insetBottom - 6;
  const scale = clamp(view.height / 390, 0.8, 1.5);
  const short = view.height <= 480;

  // Top bar: logo and version on the left, tools on the right.
  const barH = 28 * scale;
  fillRound(ctx, { x: -20, y: -20, w: view.width + 40, h: top + barH + 26 }, 0, 'rgba(0,0,0,0.2)');
  const logoW = drawLogo(ctx, left, top + barH / 2 + 1, 19 * scale);
  let chipX = right;
  const chips = [...screen.topButtons].reverse();
  for (const button of chips) {
    const w = chipWidth(ctx, button, barH - 2);
    chipX -= w;
    drawChip(ctx, button, { x: chipX, y: top + 1, w, h: barH - 2 }, regions);
    chipX -= 6;
  }
  const metaMax = chipX - (left + logoW + 12) - 8;
  if (metaMax > 60) {
    text(ctx, fit(ctx, `${screen.topLabel.replace(/^4A4 · /, '')} · ${screen.seedLabel}`, 11 * scale, metaMax),
      left + logoW + 12, top + barH / 2 + 1, 11 * scale, COLOR.inkSoft);
  }

  // Hand along the bottom, buttons and status just above it.
  const metrics = handMetrics(view, screen);
  const { cardH, cardW, lift } = metrics;
  const handTop = bottom - metrics.height;
  const btnH = clamp(view.height * 0.085, 30, 50);
  const dockY = handTop - 8 - btnH;
  const stageTop = top + barH + 8;
  const stageBottom = dockY - 6;

  // Felt ring.
  ctx.beginPath();
  ctx.ellipse(view.width / 2, (stageTop + stageBottom) / 2 + 4, (right - left) * 0.42, (stageBottom - stageTop) * 0.55, 0, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.stroke();

  if (screen.start === null) {
    // Seats: partner on top, opponents left and right.
    const r = clamp(view.height * 0.045, 16, 29);
    const counterShift = screen.counter !== null ? 40 * scale : 0;
    // An open counter pushes the seats down a little; side seats move less so they keep clear of your play.
    const sideY = stageTop + (stageBottom - stageTop) * 0.36 + counterShift * 0.6;
    const seatAt: Record<Exclude<SeatPosition, 'bottom'>, SeatLayout> = {
      top: { x: view.width / 2 - (short ? 60 : 24) * scale, y: stageTop + r + 2 + counterShift, r },
      left: { x: left + r + 18 * scale, y: sideY, r },
      right: { x: right - r - 18 * scale, y: sideY, r },
    };
    for (const seat of screen.seats) {
      if (seat.position !== 'bottom') drawSeat(ctx, seat, seatAt[seat.position], scale);
    }

    // Each seat's latest action in front of it.
    const miniH = clamp(view.height * 0.105, 36, 74);
    const effects = overlay.effects?.zones ?? {};
    const sideGap = r * 2 + 46 * scale;
    const zoneAt: Record<SeatPosition, { x: number; y: number; anchor: 'center' | 'left' | 'right'; from: { dx: number; dy: number }; row: boolean }> = {
      top: short
        ? { x: seatAt.top.x + r + 90 * scale, y: seatAt.top.y, anchor: 'left', from: { dx: 0, dy: -30 }, row: true }
        : { x: view.width / 2, y: seatAt.top.y + r + 16 + miniH / 2 + 8, anchor: 'center', from: { dx: 0, dy: -30 }, row: false },
      left: { x: left + sideGap, y: sideY, anchor: 'left', from: { dx: -50, dy: 0 }, row: false },
      right: { x: right - sideGap, y: sideY, anchor: 'right', from: { dx: 50, dy: 0 }, row: false },
      bottom: { x: view.width / 2, y: stageBottom - (miniH + 30) / 2, anchor: 'center', from: { dx: 0, dy: 60 }, row: false },
    };
    for (const position of ['top', 'left', 'right', 'bottom'] as const) {
      const zone = screen.zones[position];
      if (zone === null) continue;
      const at = zoneAt[position];
      drawZone(ctx, zone, at.x, at.y, at.anchor, miniH, scale, effects[position] ?? 1, at.from, screen.showCopy, at.row);
    }

    // Card counter strip along the top of the table.
    if (screen.counter !== null) {
      const entries = screen.counter.entries;
      const cellW = 28 * scale;
      const cellH = 30 * scale;
      const titleW = 46 * scale;
      const w = titleW + entries.length * (cellW + 3) + 10;
      const x = view.width / 2 - w / 2;
      const y = stageTop - 2;
      fillRound(ctx, { x, y, w, h: cellH + 8 }, 10, 'rgba(0,30,18,0.78)');
      text(ctx, '记牌器', x + 8, y + cellH / 2 - 2, 11 * scale, COLOR.gold, 'left', 900);
      text(ctx, screen.counter.subtitle, x + 8, y + cellH / 2 + 11 * scale, 8 * scale, COLOR.inkSoft, 'left');
      entries.forEach((entry, index) => {
        const cx = x + titleW + index * (cellW + 3);
        ctx.globalAlpha = entry.unseen === 0 ? 0.35 : 1;
        fillRound(ctx, { x: cx, y: y + 4, w: cellW, h: cellH }, 6, 'rgba(255,255,255,0.12)');
        text(ctx, entry.label, cx + cellW / 2, y + 4 + cellH * 0.3, 10 * scale, COLOR.ink, 'center', 700);
        text(ctx, `${entry.unseen}`, cx + cellW / 2, y + 4 + cellH * 0.72, 12 * scale, COLOR.gold, 'center', 900);
        ctx.globalAlpha = 1;
      });
    }

    // Dock: status on the left, buttons in the middle, caption and error on the right.
    const gap = 10;
    const buttonW = Math.min(clamp(view.height * 0.22, 70, 130), ((right - left) * 0.5) / Math.max(1, screen.buttons.length) - gap);
    const buttonsW = screen.buttons.length * buttonW + Math.max(0, screen.buttons.length - 1) * gap;
    const buttonsX = view.width / 2 - buttonsW / 2;
    screen.buttons.forEach((button, index) => drawButton(ctx, button, { x: buttonsX + index * (buttonW + gap), y: dockY, w: buttonW, h: btnH }, regions));
    const sideW = Math.max(40, buttonsX - left - 12);
    const statusSize = clamp(13 * scale, 12, 17);
    text(ctx, fit(ctx, screen.status.text, statusSize, sideW, 800), left, dockY + btnH / 2, statusSize, screen.status.forHuman ? COLOR.gold : COLOR.inkSoft, 'left', 800);
    const rightX = right;
    const rightW = Math.max(40, right - (buttonsX + buttonsW) - 12);
    const captionSize = clamp(12 * scale, 11, 15);
    if (screen.error) {
      text(ctx, fit(ctx, screen.caption, captionSize, rightW, 700), rightX, dockY + btnH * 0.3, captionSize, COLOR.ink, 'right', 700);
      text(ctx, fit(ctx, screen.error, captionSize, rightW, 700), rightX, dockY + btnH * 0.78, captionSize, '#ffe1dc', 'right', 700);
    } else {
      text(ctx, fit(ctx, screen.caption, captionSize, rightW, 700), rightX, dockY + btnH / 2, captionSize, COLOR.ink, 'right', 700);
    }

    // The hand.
    drawHand(ctx, screen, metrics, left, right, handTop, cardW, cardH, lift, regions);

    // Bomb banner.
    const flash = overlay.effects?.flash;
    if (flash !== null && flash !== undefined && flash.progress < 1) {
      const p = flash.progress;
      const grow = p < 0.18 ? 0.4 + (p / 0.18) * 0.72 : p < 0.3 ? 1.12 - ((p - 0.18) / 0.12) * 0.12 : 1;
      const alpha = p < 0.78 ? Math.min(1, p / 0.12) : Math.max(0, 1 - (p - 0.78) / 0.22);
      const size = clamp(view.height * 0.11, 30, 64);
      const w = textWidth(ctx, flash.text, size, 900) + size;
      const cx = view.width / 2;
      const cy = (stageTop + stageBottom) / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(grow, grow);
      fillRound(ctx, { x: -w / 2, y: -size * 0.75, w, h: size * 1.5 }, size * 0.4, COLOR.goldDeep);
      fillRound(ctx, { x: -w / 2 + 4, y: -size * 0.75 + 4, w: w - 8, h: size * 1.5 - 8 }, size * 0.36, COLOR.gold);
      text(ctx, flash.text, 0, 2, size, '#5a1d00', 'center', 900);
      ctx.restore();
    }
  }

  if (overlay.notice) drawNotice(ctx, view, overlay.notice, stageTop + 40);

  if (screen.start !== null) {
    scrim(ctx, view);
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

function drawHand(ctx: Canvas2D, screen: TableScreen, metrics: ReturnType<typeof handMetrics>, left: number, right: number,
  handTop: number, cardW: number, cardH: number, lift: number, regions: HitRegion[]): void {
  const hand = screen.hand;
  const width = right - left;
  if (hand.cards.length === 0) {
    if (screen.start === null && screen.result === null) {
      text(ctx, '你的牌已经出完', (left + right) / 2, handTop + cardH / 2, 14, COLOR.inkSoft, 'center', 700);
    }
    return;
  }
  const dimmedOf = (card: Card) => hand.eligible !== null && !hand.eligible.has(card.id);
  if (!screen.handColumns) {
    const cards = hand.cards;
    const step = cards.length <= 1 ? 0 : Math.min(cardW * 0.62, (width - cardW) / (cards.length - 1));
    const total = step * Math.max(0, cards.length - 1) + cardW;
    const start = left + (width - total) / 2;
    const y = handTop + lift;
    cards.forEach((card, index) => {
      const selected = hand.selected.has(card.id);
      const x = start + index * step;
      const dimmed = dimmedOf(card);
      drawCard(ctx, card, { x, y: y - (selected ? lift : 0), w: cardW, h: cardH }, { selected, dimmed, showCopy: screen.showCopy });
      if (hand.enabled && !dimmed) {
        const isLast = index === cards.length - 1;
        regions.push({ cardId: card.id, rect: { x, y: handTop, w: isLast ? cardW : step, h: cardH + lift } });
      }
    });
    return;
  }
  const columns = metrics.columns;
  const gap = Math.min(6, cardW * 0.06);
  const colW = Math.min(cardW, (width - gap * (columns.length - 1)) / columns.length);
  const total = colW * columns.length + gap * (columns.length - 1);
  const start = left + (width - total) / 2;
  const tallest = Math.max(...columns.map((column) => column.length));
  columns.forEach((column, columnIndex) => {
    const x = start + columnIndex * (colW + gap);
    // Shorter columns sit lower, so every column's last card lines up along the bottom.
    const columnTop = handTop + 4 + (tallest - column.length) * metrics.strip;
    column.forEach((card, index) => {
      const selected = hand.selected.has(card.id);
      const y = columnTop + index * metrics.strip;
      const dimmed = dimmedOf(card);
      drawCard(ctx, card, { x, y: y - (selected ? 6 : 0), w: colW, h: cardH }, { selected, dimmed, showCopy: screen.showCopy });
      if (hand.enabled && !dimmed) {
        const isLast = index === column.length - 1;
        regions.push({ cardId: card.id, column: columnIndex, rect: { x, y, w: colW, h: isLast ? cardH : metrics.strip } });
      }
    });
  });
}

/** The online room before a game: two team columns of seats, the version, and invite/start buttons. */
export function drawLobbyFrame(ctx: Canvas2D, view: Viewport, lobby: LobbyScreen, overlay: Overlay): HitRegion[] {
  const regions: HitRegion[] = [];
  drawFelt(ctx, view);
  const w = Math.min(580, view.width - view.insetLeft - view.insetRight - 24);
  const h = Math.min(360, view.height - view.insetTop - view.insetBottom - 12);
  const r = { x: (view.width - w) / 2, y: view.insetTop + (view.height - view.insetTop - view.insetBottom - h) / 2, w, h };
  panel(ctx, r);
  const pad = 18;
  text(ctx, lobby.title, r.x + pad, r.y + 26, 22, COLOR.panelInk, 'left', 900);
  text(ctx, fit(ctx, lobby.subtitle, 12, w - pad * 2 - 230), r.x + pad + 160, r.y + 27, 12, COLOR.panelMuted);
  drawButton(ctx, { id: 'help', label: '规则', enabled: true, style: 'quiet' }, { x: r.x + w - pad - 56, y: r.y + 12, w: 56, h: 28 }, regions);

  // Table size, then (four players only) the deck version; the host may change them.
  const toggleY = r.y + 50;
  const toggle = (box: Rect, label: string, chosen: boolean, action: ActionId) => {
    roundRect(ctx, box, 14);
    ctx.fillStyle = chosen ? '#fff0c4' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = chosen ? COLOR.goldDeep : COLOR.panelLine;
    ctx.stroke();
    text(ctx, label, box.x + box.w / 2, box.y + 14, 13, COLOR.panelInk, 'center', 800);
    if (lobby.deckEditable && !chosen) regions.push({ rect: box, action });
  };
  let toggleX = r.x + pad;
  for (const size of [4, 3, 2] as const) {
    toggle({ x: toggleX, y: toggleY, w: 54, h: 28 }, `${size} 人`, lobby.playerCount === size, `players-${size}`);
    toggleX += 60;
  }
  if (lobby.playerCount === 4) {
    toggleX += 8;
    DECK_OPTIONS.forEach((option) => {
      toggle({ x: toggleX, y: toggleY, w: 72, h: 28 }, option.label, option.deckCount === lobby.deckCount, option.deckCount === 1 ? 'deck-1' : 'deck-2');
      toggleX += 78;
    });
  }
  const noteX = toggleX + 10;
  text(ctx, fit(ctx, lobby.note, 11, r.x + w - pad - noteX), noteX, toggleY + 14, 11, COLOR.panelMuted);

  // Seats. Four players: seats 1 and 3 (blue) on the left, 2 and 4 (gold) on the right. Fewer: one per slot.
  const gridTop = toggleY + 42;
  const buttonsH = 40;
  const gridH = r.y + h - pad - buttonsH - 26 - gridTop;
  const teams = lobby.playerCount === 4;
  const colW = (w - pad * 2 - 12) / 2;
  const slotH = (gridH - 10) / 2;
  for (const seat of lobby.seats) {
    const column = teams ? seat.team : seat.seat % 2;
    const row = teams ? (seat.seat < 2 ? 0 : 1) : Math.floor(seat.seat / 2);
    const box = { x: r.x + pad + column * (colW + 12), y: gridTop + row * (slotH + 10), w: colW, h: slotH };
    roundRect(ctx, box, 12);
    ctx.fillStyle = seat.isMe ? '#fff0c4' : seat.empty ? '#f5efe0' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = seat.isMe ? COLOR.goldDeep : COLOR.panelLine;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(box.x + 26, box.y + slotH / 2, 14, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[seat.team] ?? COLOR.team0;
    ctx.fill();
    text(ctx, `${seat.seat + 1}`, box.x + 26, box.y + slotH / 2 + 1, 13, '#ffffff', 'center', 900);
    text(ctx, fit(ctx, seat.label, 15, box.w - 70, 800), box.x + 50, box.y + slotH / 2 - (seat.detail ? 8 : 0), 15, seat.empty ? COLOR.panelMuted : COLOR.panelInk, 'left', 800);
    if (seat.detail) text(ctx, fit(ctx, seat.detail, 11, box.w - 64), box.x + 50, box.y + slotH / 2 + 12, 11, COLOR.panelMuted);
    if (seat.action !== null) regions.push({ rect: box, action: seat.action });
  }
  if (teams) {
    text(ctx, '蓝队', r.x + pad + colW, gridTop - 9, 10, COLOR.team0, 'right', 800);
    text(ctx, '金队', r.x + pad + colW * 2 + 12, gridTop - 9, 10, COLOR.team1, 'right', 800);
  }

  if (lobby.error) text(ctx, fit(ctx, lobby.error, 12, w - pad * 2), r.x + pad, r.y + h - pad - buttonsH - 12, 12, COLOR.red, 'left', 700);
  const count = lobby.buttons.length;
  const bw = Math.min(150, (w - pad * 2 - (count - 1) * 10) / count);
  lobby.buttons.forEach((button, index) => drawButton(ctx, button,
    { x: r.x + w - pad - (count - index) * (bw + 10) + 10, y: r.y + h - pad - buttonsH, w: bw, h: buttonsH - 4 }, regions));

  if (overlay.notice) drawNotice(ctx, view, overlay.notice, r.y + 8);
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
