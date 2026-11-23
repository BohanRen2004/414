import { Card, Rank } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck, DEFAULT_DECK_COUNT, DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { recognize } from '../../client/assets/scripts/core/patterns/recognize';
import { DECK_OPTIONS, deckOption } from '../../client/assets/scripts/ui/deck-options';
import { dragSelection } from '../../client/assets/scripts/ui/hand-selection';
import {
  SUIT_GLYPH, errorMessage, formatSeed, isRedCard, phaseMessage, playerName, rankLabel, sortCardsForDisplay,
} from '../../client/assets/scripts/ui/labels';
import { SeatActionViewModel } from '../../client/assets/scripts/ui/table-view-model';
import { BrowserGameSession, BrowserSessionSnapshot } from './browser-session';
import { isMuted, playSound, setMuted, unlockAudio } from './sound';
import './style.css';

type Position = 'top' | 'left' | 'right' | 'bottom';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) throw new Error('Missing #app root');

// One deck uses the same card IDs as the first of two decks, so this map serves both versions.
const allCards = new Map(createDoubleDeck().map((card) => [card.id, card]));

/** Pause after each shown move, long enough to follow the AIs' plays. */
const MOVE_DELAY_MS = 520;
/** How long a new play takes to land in front of its seat, and how long the bomb banner stays. */
const LAND_MS = 380;
const FLASH_MS = 1100;

let helpOpen = false;
let counterOpen = false;
let notice = '';
let noticeTimer: number | undefined;
/** Version picked on the start screen; "同种子重开" and "新开一局" keep it. */
let chosenDeckCount: DeckCount = readDeckCountFromUrl() ?? DEFAULT_DECK_COUNT;
let session = new BrowserGameSession(readSeedFromUrl() ?? 414, { deckCount: chosenDeckCount, animationDelayMs: MOVE_DELAY_MS });
/** When each seat's shown action first appeared, so re-renders continue its landing animation instead of restarting it. */
const landed = new Map<Position, { key: number; at: number }>();
let flash: { text: string; at: number } | null = null;
let flashTimer: number | undefined;
let unsubscribe = session.subscribe(onSnapshot);

function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function readSeedFromUrl(): number | null {
  const value = new URLSearchParams(window.location.search).get('seed');
  if (value === null || !/^\d{1,10}$/.test(value)) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff ? seed : null;
}

function readDeckCountFromUrl(): DeckCount | null {
  const value = new URLSearchParams(window.location.search).get('decks');
  return value === '1' ? 1 : value === '2' ? 2 : null;
}

/** The started game's version, or the one chosen for the next start. */
function shownDeckCount(snapshot: BrowserSessionSnapshot): DeckCount {
  return snapshot.state.deckCount ?? chosenDeckCount;
}

// --- Screen size -------------------------------------------------------------------------------------------

function touchLayout(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function isPhone(): boolean {
  return touchLayout() && Math.min(window.innerWidth, window.innerHeight) <= 540;
}

/**
 * The game is one landscape screen. Its size goes to --app-w/--app-h; a phone held upright gets the whole
 * game turned a quarter (html.rotated), with the notch side kept clear through --safe-left/--safe-right.
 */
function applyLayout(): void {
  // A keyboard opening for the seed field shrinks the window; keep the layout until it closes.
  if (document.activeElement instanceof HTMLInputElement && document.documentElement.classList.contains('phone')) return;
  const html = document.documentElement;
  const phone = isPhone();
  const rotated = phone && window.innerHeight > window.innerWidth;
  html.classList.toggle('phone', phone);
  html.classList.toggle('rotated', rotated);
  // A short table (phones in landscape) puts the partner's play beside the partner instead of below.
  html.classList.toggle('short', (rotated ? window.innerWidth : window.innerHeight) <= 480);
  html.style.setProperty('--app-w', `${rotated ? window.innerHeight : window.innerWidth}px`);
  html.style.setProperty('--app-h', `${rotated ? window.innerWidth : window.innerHeight}px`);
  html.style.setProperty('--safe-left', rotated ? 'env(safe-area-inset-top, 0px)' : 'env(safe-area-inset-left, 0px)');
  html.style.setProperty('--safe-right', rotated ? 'env(safe-area-inset-bottom, 0px)' : 'env(safe-area-inset-right, 0px)');
}
applyLayout();
window.addEventListener('resize', () => {
  applyLayout();
  render(session.snapshot());
});

// --- Pieces ------------------------------------------------------------------------------------------------

function renderCard(card: Card, options: { size?: 'hand' | 'mini'; copy?: boolean } = {}): string {
  const joker = card.rank === Rank.SMALL_JOKER || card.rank === Rank.BIG_JOKER;
  const classes = ['card', options.size === 'mini' ? 'is-mini' : '', isRedCard(card) ? 'is-red' : '', joker ? 'is-joker' : ''].filter(Boolean).join(' ');
  const rank = rankLabel(card.rank);
  const glyph = SUIT_GLYPH[card.suit];
  const corner = joker
    ? `<b class="card-rank joker-rank">${card.rank === Rank.BIG_JOKER ? '大' : '小'}</b><b class="card-rank joker-rank">王</b>`
    : `<b class="card-rank">${escapeHtml(rank)}</b><i class="card-suit">${glyph}</i>`;
  const copy = options.copy ? `<small class="card-copy">${card.deckIndex === 0 ? 'Ⅰ' : 'Ⅱ'}</small>` : '';
  return `<span class="${classes}" aria-label="${escapeHtml(joker ? (card.rank === Rank.BIG_JOKER ? '大王' : '小王') : rank + glyph)}">
    <span class="card-corner">${corner}</span><span class="card-pip">${joker ? '★' : glyph}</span>${copy}</span>`;
}

const SEAT_LETTER: Readonly<Record<number, string>> = { 0: '你', 1: '左', 2: '搭', 3: '右' };

function renderSeat(position: Position, snapshot: BrowserSessionSnapshot): string {
  const seat = snapshot.viewModel.seats[position];
  const active = snapshot.state.currentPlayer === seat.playerId && snapshot.state.phase !== 'ROUND_RESULT';
  const out = seat.finishPlace !== null;
  const badges = [
    seat.reportCount !== null && !out ? `<span class="seat-alert">报${seat.reportCount}</span>` : '',
    out ? `<span class="seat-place">第 ${seat.finishPlace} 名</span>` : '',
  ].join('');
  return `<section class="seat seat-${position} team-${seat.teamId} ${active ? 'is-active' : ''} ${out ? 'is-out' : ''}"
      aria-label="${escapeHtml(playerName(seat.playerId))}，剩 ${seat.remaining} 张">
    <div class="avatar">${SEAT_LETTER[seat.playerId]}${active ? '<span class="thinking" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}</div>
    <div class="seat-info">
      <strong>${escapeHtml(playerName(seat.playerId))}</strong>
      <span class="seat-count"><span class="card-back" aria-hidden="true"></span>${seat.remaining}</span>
      ${badges}
    </div>
  </section>`;
}

/** Animation style for an action that has just appeared; a re-render continues it rather than replaying it. */
function landingStyle(position: Position, action: SeatActionViewModel): string {
  const now = performance.now();
  const seen = landed.get(position);
  if (seen === undefined || seen.key !== action.key) {
    landed.set(position, { key: action.key, at: now });
    return 'animation-delay: 0ms';
  }
  const elapsed = now - seen.at;
  return elapsed >= LAND_MS ? 'animation: none' : `animation-delay: -${Math.round(elapsed)}ms`;
}

function renderZone(position: Position, snapshot: BrowserSessionSnapshot): string {
  const action = snapshot.viewModel.seatActions[position];
  if (action === null) {
    landed.delete(position);
    return `<div class="zone zone-${position}"></div>`;
  }
  const style = landingStyle(position, action);
  if (action.kind === 'PASS') {
    return `<div class="zone zone-${position}"><span class="bubble is-pass" style="${style}">不出</span></div>`;
  }
  const copy = shownDeckCount(snapshot) === 2;
  const cards = action.cardIds.flatMap((id) => {
    const card = allCards.get(id);
    return card === undefined ? [] : [renderCard(card, { size: 'mini', copy })];
  }).join('');
  const label = action.kind === 'PLAY'
    ? `<span class="play-label ${action.bomb ? 'is-bomb' : ''}">${escapeHtml(action.label)}${action.leading ? '<em>最大</em>' : ''}</span>`
    : `<span class="bubble is-goucha">${escapeHtml(action.label)}！</span>`;
  return `<div class="zone zone-${position}">
    <div class="played ${action.leading ? 'is-leading' : ''} ${action.bomb ? 'is-bomb' : ''}" style="${style}">
      <div class="played-cards">${cards}</div>${label}
    </div>
  </div>`;
}

function renderCounter(snapshot: BrowserSessionSnapshot): string {
  if (!counterOpen) return '';
  const entries = snapshot.viewModel.cardCounter;
  if (entries.length === 0) return '';
  return `<section class="counter" aria-label="记牌器：其他三家手里还剩的牌">
    <div class="counter-title">记牌器<small>三家还剩</small></div>
    <ol>${entries.map((entry) => `<li class="${entry.unseen === 0 ? 'is-gone' : ''}"><b>${escapeHtml(entry.label)}</b><span>${entry.unseen}</span></li>`).join('')}</ol>
  </section>`;
}

function renderBar(snapshot: BrowserSessionSnapshot): string {
  const started = snapshot.state.phase !== 'SETUP';
  const seed = snapshot.state.rootSeed ?? session.seed;
  const option = deckOption(shownDeckCount(snapshot));
  return `<header class="bar">
    <div class="bar-title"><span class="logo">4<i>A</i>4</span><span class="bar-meta">${escapeHtml(option.label)} · 种子 ${escapeHtml(formatSeed(seed))}</span></div>
    <nav class="bar-actions" aria-label="游戏工具">
      <button class="chip ${counterOpen ? 'is-on' : ''}" data-action="counter" ${started ? '' : 'disabled'} aria-pressed="${counterOpen}">记牌器</button>
      <button class="chip" data-action="sound" aria-pressed="${!isMuted()}">${isMuted() ? '音效 关' : '音效 开'}</button>
      <button class="chip" data-action="help">规则</button>
      <button class="chip" data-action="new-game" ${snapshot.isBusy ? 'disabled' : ''}>新开一局</button>
    </nav>
  </header>`;
}

function renderDock(snapshot: BrowserSessionSnapshot): string {
  const { viewModel, state } = snapshot;
  const picked = snapshot.selectedCardIds;
  const prompt = viewModel.gouCha;
  const busy = snapshot.isBusy;
  const error = errorMessage(viewModel.controls.errorKey ?? snapshot.errorCode);
  const status = phaseMessage(state, viewModel, busy);
  let buttons = '';
  if (prompt !== null) {
    const eligible = new Set(prompt.eligibleCardIds);
    const valid = picked.length === prompt.requiredCount && picked.every((id) => eligible.has(id));
    const verb = prompt.addition === 'CHA' ? '岔' : '勾';
    buttons = `<button class="btn btn-pass" data-action="decline-goucha" ${busy ? 'disabled' : ''}>放弃</button>
      <button class="btn btn-play" data-action="confirm-goucha" ${!valid || busy ? 'disabled' : ''}>${verb}！</button>`;
  } else if (viewModel.controls.showPlay) {
    buttons = `${viewModel.controls.showPass ? `<button class="btn btn-pass" data-action="pass" title="快捷键 P" ${busy ? 'disabled' : ''}>不出</button>` : ''}
      <button class="btn btn-hint" data-action="hint" title="快捷键 H" ${busy ? 'disabled' : ''}>提示</button>
      <button class="btn btn-play" data-action="play" title="快捷键 回车" ${!viewModel.controls.playEnabled || busy ? 'disabled' : ''}>出牌</button>`;
  }
  const caption = prompt !== null
    ? `${prompt.addition === 'CHA' ? '岔' : '勾'} ${rankLabel(prompt.rank)}：${prompt.addition === 'CHA' ? '选两张同点数的牌' : '选一张同点数的牌'}`
    : picked.length > 0 ? `已选 ${picked.length} 张` : '';
  return `<div class="dock-bar">
    <div class="dock-status ${state.currentPlayer === 0 && !busy ? 'is-yours' : ''}" role="status" aria-live="polite">${escapeHtml(status)}</div>
    <div class="dock-buttons">${buttons}</div>
    <div class="dock-side">
      ${caption ? `<span class="dock-caption">${escapeHtml(caption)}</span>` : ''}
      ${picked.length > 0 && !busy ? '<button class="link" data-action="clear">清除</button>' : ''}
      ${error ? `<span class="dock-error">${escapeHtml(error)}</span>` : ''}
    </div>
  </div>`;
}

/** Two decks deal 27 cards: they sit in columns by rank, the way 掼蛋 games show a big hand. One deck is one row. */
function usesColumns(snapshot: BrowserSessionSnapshot): boolean {
  return shownDeckCount(snapshot) === 2;
}

function renderHand(snapshot: BrowserSessionSnapshot): string {
  const hand = snapshot.viewModel.seats.bottom.cards ?? [];
  if (hand.length === 0) {
    return snapshot.state.phase === 'SETUP' ? '' : '<p class="hand-empty">你的牌已经出完</p>';
  }
  const copy = shownDeckCount(snapshot) === 2;
  const selected = new Set(snapshot.selectedCardIds);
  const prompt = snapshot.viewModel.gouCha;
  const eligible = prompt === null ? null : new Set(prompt.eligibleCardIds);
  const button = (card: Card): string => {
    const picked = selected.has(card.id);
    const dimmed = eligible !== null && !eligible.has(card.id);
    return `<button class="hand-card ${picked ? 'is-picked' : ''} ${dimmed ? 'is-dimmed' : ''}" type="button"
      data-action="toggle-card" data-card-id="${escapeHtml(card.id)}" aria-pressed="${picked}"
      ${snapshot.isBusy || dimmed ? 'disabled' : ''}>${renderCard(card, { copy })}</button>`;
  };
  const sorted = sortCardsForDisplay(hand);
  if (!usesColumns(snapshot)) return `<div class="hand is-row">${sorted.map(button).join('')}</div>`;
  const columns: Card[][] = [];
  for (const card of sorted) {
    const last = columns[columns.length - 1];
    if (last !== undefined && last[0]!.rank === card.rank) last.push(card);
    else columns.push([card]);
  }
  const tallest = Math.max(...columns.map((column) => column.length));
  return `<div class="hand is-columns" style="--tallest: ${tallest}">${columns
    .map((column) => `<div class="hand-column">${column.map(button).join('')}</div>`).join('')}</div>`;
}

function renderFlash(): string {
  if (flash === null) return '';
  const elapsed = performance.now() - flash.at;
  if (elapsed >= FLASH_MS) return '';
  return `<div class="flash" aria-hidden="true" style="animation-delay: -${Math.round(elapsed)}ms"><span>${escapeHtml(flash.text)}</span></div>`;
}

function renderDeckChoice(): string {
  const options = DECK_OPTIONS.map((option) => `<label class="deck-option">
      <input type="radio" name="deck" value="${option.deckCount}" ${option.deckCount === chosenDeckCount ? 'checked' : ''} />
      <span class="deck-option-body"><b>${escapeHtml(option.label)}</b><small>${escapeHtml(option.summary)}</small></span>
    </label>`).join('');
  return `<div class="deck-options" role="radiogroup" aria-label="牌数">${options}</div>`;
}

function renderStart(snapshot: BrowserSessionSnapshot): string {
  if (snapshot.state.phase !== 'SETUP') return '';
  return `<div class="modal"><section class="panel start-panel" role="dialog" aria-modal="true" aria-labelledby="start-title">
    <div class="start-hero">
      <div class="logo logo-big">4<i>A</i>4</div>
      <h1 id="start-title">四人两队，和三位 AI 打一局</h1>
      <p>你和对面的搭档一队。先出完的一方获胜，抓的人越多赢得越漂亮。</p>
    </div>
    <form id="start-form" class="start-form">
      ${renderDeckChoice()}
      <details class="seed-details">
        <summary>指定种子（可复现同一局）</summary>
        <div class="seed-entry"><span>#</span><input id="seed-input" name="seed" inputmode="numeric" pattern="[0-9]{1,10}" maxlength="10" value="${snapshot.state.rootSeed ?? session.seed}" aria-label="随机种子" aria-describedby="seed-error" /></div>
      </details>
      <p id="seed-error" class="form-error" role="alert"></p>
      <button class="btn btn-play btn-wide" type="submit">开始游戏</button>
      <button class="link" type="button" data-action="help">先看规则</button>
    </form>
  </section></div>`;
}

function renderResult(snapshot: BrowserSessionSnapshot): string {
  const result = snapshot.viewModel.result;
  if (result === null) return '';
  const won = result.winningTeam === 0;
  const order = result.places.map((playerId, index) => `<li class="${playerId % 2 === result.winningTeam ? 'is-winner' : ''}">
      <span class="place">第 ${index + 1} 名</span><span>${escapeHtml(playerName(playerId))}</span></li>`).join('');
  return `<div class="modal"><section class="panel result-panel ${won ? 'is-win' : 'is-lose'}" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <div class="result-ribbon">${won ? '胜利' : '惜败'}</div>
    <h2 id="result-title">${won ? '你们队拿下这局！' : '对方拿下这局'}</h2>
    <p class="result-sub">抓了 ${result.capturedOpponents} 人 · ${escapeHtml(deckOption(shownDeckCount(snapshot)).label)} · 种子 ${escapeHtml(formatSeed(result.seed))}</p>
    <ol class="result-order">${order}</ol>
    <div class="result-actions">
      <button class="btn btn-hint" data-action="replay">同种子重开</button>
      <button class="btn btn-play" data-action="new-game">再来一局</button>
    </div>
  </section></div>`;
}

function renderHelp(): string {
  if (!helpOpen) return '';
  return `<div class="modal" data-action="close-help">
    <section class="panel help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title" data-dialog>
      <button class="close" data-action="close-help" aria-label="关闭规则">×</button>
      <h2 id="help-title">规则速览</h2>
      <div class="rules">
        <article><b>队伍</b><span>四人两队：你和对面的搭档一队，左右两家一队。两副牌每人 27 张；一副牌 54 张，每队一人 14 张、一人 13 张。</span></article>
        <article><b>首家</b><span>持红桃 3 的玩家先出。两副牌时依次比较红桃 3、黑桃 3、梅花 3、方块 3 的张数，多者先出。</span></article>
        <article><b>牌型</b><span>单张、对子、单/双/三顺、轰（3 张）/炸弹（4 张以上）、王炸、4A4（两张 4 加一张 A，最大）。</span></article>
        <article><b>出牌</b><span>轮流压过上一手或选择不出；其他人都不要时，最后压住的人接着出，他已出完就由搭档接着出（借光）。</span></article>
        <article><b>勾岔</b><span>单牌可以被别人用同点数的对子“岔”，岔之后才能用同点数单张“勾”，岔勾交替。有人岔过后链条一停，这一轮立刻结束，最后岔或勾的人接着出。</span></article>
        <article><b>结算</b><span>只剩一人有牌时结束：第一个出完的人那队获胜，搭档之后出完的对手越少，抓的人越多。</span></article>
      </div>
      <p class="help-tip">操作：点牌选择，按住横着滑可以一次选一串；快捷键 H 提示、P 不出、回车出牌。</p>
      <button class="btn btn-play" data-action="close-help">明白了</button>
    </section>
  </div>`;
}

function render(snapshot: BrowserSessionSnapshot): void {
  const started = snapshot.state.phase !== 'SETUP';
  const shake = flash !== null && performance.now() - flash.at < 450;
  root!.innerHTML = `<div class="game ${started ? 'is-playing' : 'is-idle'}">
    ${renderBar(snapshot)}
    <main class="stage ${shake ? 'is-shaking' : ''} ${counterOpen && started ? 'has-counter' : ''}" aria-label="牌桌">
      <div class="felt" aria-hidden="true"></div>
      ${started ? `${renderSeat('top', snapshot)}${renderSeat('left', snapshot)}${renderSeat('right', snapshot)}
        ${renderZone('top', snapshot)}${renderZone('left', snapshot)}${renderZone('right', snapshot)}${renderZone('bottom', snapshot)}` : ''}
      ${renderCounter(snapshot)}
      ${renderFlash()}
    </main>
    <section class="dock" aria-label="你的手牌和操作">
      ${started ? renderDock(snapshot) : ''}
      ${renderHand(snapshot)}
    </section>
    ${renderStart(snapshot)}${renderResult(snapshot)}${renderHelp()}
    <div class="toast ${notice ? 'is-visible' : ''}" role="status" aria-live="polite">${escapeHtml(notice)}</div>
  </div>`;
}

// --- Sounds and effects from what each shown frame did -----------------------------------------------------

const BOMB_KINDS = new Set(['N_OF_KIND_BOMB', 'JOKER_BOMB', 'FOUR_A_FOUR']);

function onSnapshot(snapshot: BrowserSessionSnapshot): void {
  for (const event of snapshot.events) {
    if (event.kind === 'CARDS_PLAYED') {
      const cards = event.cardIds.flatMap((id) => {
        const card = allCards.get(id);
        return card === undefined ? [] : [card];
      });
      const pattern = recognize(cards);
      if (BOMB_KINDS.has(pattern.kind)) {
        const label = pattern.kind === 'JOKER_BOMB' ? '王炸' : pattern.kind === 'FOUR_A_FOUR' ? '4A4' : cards.length === 3 ? '轰' : '炸弹';
        flash = { text: label, at: performance.now() };
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => render(session.snapshot()), FLASH_MS + 20);
        playSound('bomb');
      } else {
        playSound('play');
      }
    } else if (event.kind === 'PLAYER_PASSED') {
      playSound('pass');
    } else if (event.kind === 'GOUCHA_ADDED') {
      playSound('cha');
    } else if (event.kind === 'TURN_CHANGED' && event.playerId === 0) {
      playSound('turn');
    } else if (event.kind === 'ROUND_FINISHED') {
      playSound(snapshot.state.result?.winningTeam === 0 ? 'win' : 'lose');
    }
  }
  render(snapshot);
}

function setNotice(message: string): void {
  notice = message;
  render(session.snapshot());
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice = '';
    render(session.snapshot());
  }, 2400);
}

function replaceSession(next: BrowserGameSession): void {
  unsubscribe();
  helpOpen = false;
  landed.clear();
  flash = null;
  session = next;
  chosenDeckCount = next.deckCount;
  unsubscribe = session.subscribe(onSnapshot);
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(next.seed));
  url.searchParams.set('decks', String(next.deckCount));
  window.history.replaceState({}, '', url);
}

function newSession(seed: number, deckCount: DeckCount): BrowserGameSession {
  return new BrowserGameSession(seed, { deckCount, animationDelayMs: MOVE_DELAY_MS });
}

function parseInputSeed(input: HTMLInputElement | null): number | null {
  const value = input?.value.trim() ?? '';
  if (!/^\d{1,10}$/.test(value)) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) && seed <= 0xffff_ffff ? seed : null;
}

// --- Input -------------------------------------------------------------------------------------------------

root.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'start-form') return;
  event.preventDefault();
  unlockAudio();
  const seedInput = form.querySelector<HTMLInputElement>('#seed-input');
  const seed = parseInputSeed(seedInput);
  if (seed === null) {
    const error = form.querySelector<HTMLElement>('#seed-error');
    if (error) error.textContent = '种子要是 0 到 4294967295 之间的整数。';
    seedInput?.focus();
    return;
  }
  const deck = form.querySelector<HTMLInputElement>('input[name="deck"]:checked');
  if (deck !== null) chosenDeckCount = deck.value === '1' ? 1 : 2;
  replaceSession(newSession(seed, chosenDeckCount));
  const started = await session.start();
  if (!started) setNotice(`无法开始游戏：${session.lastErrorCode ?? '未知错误'}`);
});

/**
 * Dragging across the hand (mouse, pen or finger) picks every card it passes; starting on a picked card
 * clears them instead. In a row the span between the first and the current card is picked; in rank
 * columns, exactly the cards the pointer crosses, so a slide along the bottom picks one of each rank.
 */
let handDrag: {
  pointer: number;
  columns: boolean;
  ids: string[];
  base: string[];
  from: number;
  to: number;
  selecting: boolean;
  visited: Set<string>;
  lastX: number;
  lastY: number;
  moved: boolean;
} | null = null;
/** Set when a drag ends; swallows the click that follows it. Every new press starts clean. */
let suppressCardClick = false;

function handCardAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('.hand-card[data-card-id]:not([disabled])') ?? null;
}

root.addEventListener('pointerdown', (event) => {
  suppressCardClick = false;
  unlockAudio();
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  const card = event.target.closest<HTMLElement>('.hand-card[data-card-id]');
  if (card === null || card.hasAttribute('disabled')) return;
  const ids = [...root.querySelectorAll<HTMLElement>('.hand-card[data-card-id]:not([disabled])')].map((element) => element.dataset.cardId ?? '');
  const id = card.dataset.cardId ?? '';
  const from = ids.indexOf(id);
  if (from < 0) return;
  // A mouse press must not start a text selection; a touch must keep its default (the page may scroll).
  if (event.pointerType !== 'touch') event.preventDefault();
  // A touch is captured by the card it started on; release it so moves over other cards hit-test normally.
  if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
  const base = [...session.selectedCardIds];
  handDrag = {
    pointer: event.pointerId,
    columns: card.closest('.is-columns') !== null,
    ids,
    base,
    from,
    to: from,
    selecting: !base.includes(id),
    visited: new Set([id]),
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
  };
});

window.addEventListener('pointermove', (event) => {
  const drag = handDrag;
  if (drag === null || drag.pointer !== event.pointerId) return;
  if (!drag.columns) {
    const index = drag.ids.indexOf(handCardAt(event.clientX, event.clientY)?.dataset.cardId ?? '');
    if (index < 0 || index === drag.to) return;
    drag.to = index;
    drag.moved = true;
    session.setSelection(dragSelection(drag.base, drag.ids, drag.from, index));
    return;
  }
  // Sample the path since the last move, so a quick slide does not skip a column.
  const steps = Math.max(1, Math.ceil(Math.hypot(event.clientX - drag.lastX, event.clientY - drag.lastY) / 8));
  let changed = false;
  for (let step = 1; step <= steps; step += 1) {
    const x = drag.lastX + (event.clientX - drag.lastX) * (step / steps);
    const y = drag.lastY + (event.clientY - drag.lastY) * (step / steps);
    const id = handCardAt(x, y)?.dataset.cardId;
    if (id !== undefined && !drag.visited.has(id)) {
      drag.visited.add(id);
      changed = true;
    }
  }
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  if (!changed) return;
  drag.moved = true;
  const next = drag.selecting
    ? [...drag.base, ...[...drag.visited].filter((id) => !drag.base.includes(id))]
    : drag.base.filter((id) => !drag.visited.has(id));
  session.setSelection(next);
});

function endHandDrag(event: PointerEvent): void {
  if (handDrag === null || handDrag.pointer !== event.pointerId) return;
  // The click that follows a drag must not toggle the card it ended on.
  suppressCardClick = handDrag.moved;
  if (handDrag.moved) playSound('select');
  handDrag = null;
}
window.addEventListener('pointerup', endHandDrag);
window.addEventListener('pointercancel', endHandDrag);

root.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>('[data-action]');
  if (button === null || button.hasAttribute('disabled')) return;
  const action = button.dataset.action;
  if (action === 'toggle-card') {
    if (suppressCardClick) {
      suppressCardClick = false;
      return;
    }
    const cardId = button.dataset.cardId;
    if (cardId !== undefined) {
      session.toggleCard(cardId);
      playSound('select');
    }
    return;
  }
  if (action === 'help') { helpOpen = true; render(session.snapshot()); return; }
  if (action === 'close-help') {
    if (target === button || target === button.parentElement) { helpOpen = false; render(session.snapshot()); }
    return;
  }
  if (action === 'counter') { counterOpen = !counterOpen; render(session.snapshot()); return; }
  if (action === 'sound') {
    setMuted(!isMuted());
    unlockAudio();
    render(session.snapshot());
    return;
  }
  if (action === 'hint') { session.cycleHint(); return; }
  if (action === 'clear') { session.clearSelection(); return; }
  if (action === 'play') {
    if (!await session.playSelection()) setNotice('请选择合法牌型后再出牌。');
    return;
  }
  if (action === 'pass') { await session.pass(); return; }
  if (action === 'confirm-goucha') {
    if (!await session.submitGouCha()) setNotice('请选择要求的同点数牌。');
    return;
  }
  if (action === 'decline-goucha') { await session.declineGouCha(); return; }
  if (action === 'replay') {
    replaceSession(session.replay());
    await session.start();
    return;
  }
  if (action === 'new-game') {
    replaceSession(newSession(Date.now() >>> 0, session.deckCount));
    return;
  }
});

// Switching the version on the start screen keeps the form as typed.
root.addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.name !== 'deck' || !input.checked) return;
  chosenDeckCount = input.value === '1' ? 1 : 2;
});

root.addEventListener('keydown', async (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'Escape' && helpOpen) { helpOpen = false; render(session.snapshot()); return; }
  if (session.state.phase === 'SETUP' || helpOpen) return;
  if (event.key.toLowerCase() === 'h') session.cycleHint();
  if (event.key.toLowerCase() === 'p') await session.pass();
  if (event.key === 'Enter') await session.playSelection();
});

render(session.snapshot());
