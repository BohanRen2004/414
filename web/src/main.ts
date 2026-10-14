import { Card } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck, DEFAULT_DECK_COUNT, DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { DECK_OPTIONS, deckOption } from '../../client/assets/scripts/ui/deck-options';
import {
  SUIT_GLYPH as suitGlyph, HISTORY_ACTION_LABEL, errorMessage, formatSeed, isRedCard, phaseMessage as tablePhaseMessage, sortCardsForDisplay, playerName, rankLabel,
} from '../../client/assets/scripts/ui/labels';
import { dragSelection } from '../../client/assets/scripts/ui/hand-selection';
import { BrowserGameSession, BrowserSessionSnapshot } from './browser-session';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) throw new Error('Missing #app root');

// One deck uses the same card IDs as the first of two decks, so this map serves both versions.
const allCards = new Map(createDoubleDeck().map((card) => [card.id, card]));

let helpOpen = false;
let notice = '';
let noticeTimer: number | undefined;
/** Version picked on the start screen; "同种子重开" and "新开一局" keep it. */
let chosenDeckCount: DeckCount = readDeckCountFromUrl() ?? DEFAULT_DECK_COUNT;
let session = new BrowserGameSession(readSeedFromUrl() ?? 414, { deckCount: chosenDeckCount });
let unsubscribe = session.subscribe(render);

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







function phaseMessage(snapshot: BrowserSessionSnapshot): string {
  return tablePhaseMessage(snapshot.state, snapshot.viewModel, snapshot.isBusy);
}

function humanError(snapshot: BrowserSessionSnapshot): string {
  return errorMessage(snapshot.viewModel.controls.errorKey ?? snapshot.errorCode);
}

function renderCard(card: Card, selected: boolean, compact = false, showCopy = true): string {
  const red = isRedCard(card);
  const rank = rankLabel(card.rank);
  const glyph = suitGlyph[card.suit];
  const classes = ['playing-card', red ? 'is-red' : '', selected ? 'is-selected' : '', compact ? 'is-compact' : '']
    .filter(Boolean).join(' ');
  return `<span class="${classes}" aria-label="${escapeHtml(rank)}${glyph}">
    <span class="card-corner"><strong>${escapeHtml(rank)}</strong><i>${glyph}</i></span>
    <span class="card-center-suit">${glyph}</span>
    ${showCopy ? `<span class="card-copy">${card.deckIndex === 0 ? 'I' : 'II'}</span>` : ''}
  </span>`;
}

function renderHand(snapshot: BrowserSessionSnapshot): string {
  const hand = snapshot.viewModel.seats.bottom.cards ?? [];
  if (hand.length === 0) {
    return `<p class="empty-hand">开局后，你的 <span data-deck-hand>${deckOption(shownDeckCount(snapshot)).handSizeLabel}</span> 张手牌会在这里显示。</p>`;
  }
  // With one deck every card is unique, so the copy mark (I/II) would only add noise.
  const showCopy = shownDeckCount(snapshot) === 2;
  const selected = new Set(snapshot.selectedCardIds);
  const prompt = snapshot.viewModel.gouCha;
  const eligible = prompt === null ? null : new Set(prompt.eligibleCardIds);
  return `<div class="hand-track" aria-label="你的手牌">${sortCardsForDisplay(hand).map((card) => {
    const active = selected.has(card.id);
    const ineligible = eligible !== null && !eligible.has(card.id);
    const cardHtml = renderCard(card, active, false, showCopy);
    return `<button class="hand-card ${active ? 'is-picked' : ''} ${ineligible ? 'is-ineligible' : ''}"
      type="button" data-action="toggle-card" data-card-id="${escapeHtml(card.id)}"
      aria-label="选择 ${escapeHtml(rankLabel(card.rank))}${suitGlyph[card.suit]}"
      aria-pressed="${active}" ${snapshot.isBusy ? 'disabled' : ''}>${cardHtml}</button>`;
  }).join('')}</div>`;
}

function renderSeat(position: 'top' | 'left' | 'right' | 'bottom', snapshot: BrowserSessionSnapshot): string {
  const seat = snapshot.viewModel.seats[position];
  const state = snapshot.state.players[seat.playerId];
  const active = snapshot.state.currentPlayer === seat.playerId;
  const human = seat.playerId === 0;
  const isPartner = seat.playerId === 2;
  const classes = ['player-seat', `seat-${position}`, active ? 'is-active' : '', human ? 'is-human' : '', isPartner ? 'is-partner' : '']
    .filter(Boolean).join(' ');
  const handbacks = human ? '' : `<span class="hidden-hand" aria-label="${seat.remaining} 张隐藏手牌">
    <i></i><i></i><i></i>
  </span>`;
  const report = seat.reportCount === null ? '' : `<span class="report-pill">报 ${seat.reportCount}</span>`;
  const place = seat.finishPlace === null ? '' : `<span class="place-pill">第 ${seat.finishPlace}</span>`;
  return `<section class="${classes}" aria-label="${playerName(seat.playerId)}，剩余 ${seat.remaining} 张">
    <div class="seat-avatar">${human ? 'YOU' : isPartner ? 'P' : 'AI'}</div>
    <div class="seat-copy">
      <div class="seat-heading"><strong>${playerName(seat.playerId)}</strong><span class="team-tag team-${seat.teamId}">${seat.teamId === 0 ? '蓝队' : '金队'}</span></div>
      <div class="seat-meta"><span>${seat.remaining} 张</span>${report}${place}</div>
    </div>
    ${handbacks}
    ${active ? '<span class="turn-pulse" aria-label="当前回合"></span>' : ''}
    <span class="sr-only">${state.controlType === 'HUMAN' ? '真人' : '基础 AI'}</span>
  </section>`;
}

function renderCenter(snapshot: BrowserSessionSnapshot): string {
  const trick = snapshot.state.trick;
  const center = snapshot.viewModel.center;
  const currentCards = center.cardIds.flatMap((id) => {
    const card = allCards.get(id);
    return card === undefined ? [] : [renderCard(card, false, true, shownDeckCount(snapshot) === 2)];
  });
  const holder = center.holderId;
  const history = snapshot.state.publicHistory.slice(-4).reverse().map((entry) => {
    const action = HISTORY_ACTION_LABEL[entry.kind];
    return `<li><span>${playerName(entry.playerId)}</span><b>${action}</b><i>#${entry.actionNumber}</i></li>`;
  }).join('');
  const content = currentCards.length > 0
    ? `<div class="table-cards">${currentCards.join('')}</div>`
    : '<div class="table-emblem"><span>4</span><i>A</i><span>4</span></div>';
  // CHA/GOU are actions on the single, so a chain reads like "单 6 · 左对家岔 · 你勾".
  const actions = center.contributions.filter((part) => part.label !== '出牌').map((part) => `${playerName(part.playerId)}${part.label}`);
  const headline = [center.patternLabel, ...actions].join(' · ');
  const contributions = center.contributions.filter((part) => part.label === '出牌').map((part) => `${playerName(part.playerId)}${part.label}`).join(' · ');
  return `<section class="center-table" aria-label="牌桌中央">
    <div class="table-orbit orbit-one"></div><div class="table-orbit orbit-two"></div>
    <div class="table-topline"><span class="eyebrow">CURRENT TRICK</span><span class="trick-index">${trick === null ? '—' : `#${trick.currentPlay.actionNumber}`}</span></div>
    <div class="pattern-label">${escapeHtml(headline)}</div>
    ${content}
    <p class="holder-line">${holder === null ? '等待首手出牌' : `当前持有：${playerName(holder)}`}</p>
    ${contributions ? `<p class="contribution-line">${escapeHtml(contributions)}</p>` : ''}
    <div class="turn-banner ${snapshot.state.currentPlayer === 0 ? 'for-human' : ''}" role="status" aria-live="polite">
      <span class="status-dot"></span>${escapeHtml(phaseMessage(snapshot))}
    </div>
    <ol class="action-history" aria-label="最近动作">${history || '<li class="history-empty">等待第一手</li>'}</ol>
  </section>`;
}

function renderControls(snapshot: BrowserSessionSnapshot): string {
  const controls = snapshot.viewModel.controls;
  const prompt = snapshot.viewModel.gouCha;
  const picked = snapshot.selectedCardIds;
  const eligible = new Set(prompt?.eligibleCardIds ?? []);
  const validGouCha = prompt !== null && picked.length === prompt.requiredCount && picked.every((id) => eligible.has(id));
  const error = humanError(snapshot);
  const actionButtons = prompt !== null
    ? `<div class="goucha-prompt" role="group" aria-label="勾岔选择">
        <div><span class="eyebrow">SPECIAL RESPONSE</span><strong>${prompt.addition === 'CHA' ? '岔' : '勾'} · ${rankLabel(prompt.rank)}</strong>
          <small>${prompt.addition === 'CHA' ? '选两张同点数的牌' : '选一张同点数的牌'}</small></div>
        <button class="button button-primary" data-action="confirm-goucha" ${!validGouCha || snapshot.isBusy ? 'disabled' : ''}>确认${prompt.addition === 'CHA' ? '岔' : '勾'}</button>
        <button class="button button-quiet" data-action="decline-goucha" ${snapshot.isBusy ? 'disabled' : ''}>放弃</button>
      </div>`
    : `<div class="play-actions">
        <button class="button button-quiet" data-action="clear" ${picked.length === 0 || snapshot.isBusy ? 'disabled' : ''}>清除</button>
        <button class="button button-quiet" data-action="hint" ${!controls.showHint || snapshot.isBusy ? 'disabled' : ''}>提示 <kbd>H</kbd></button>
        <button class="button button-secondary" data-action="pass" ${!controls.showPass || snapshot.isBusy ? 'disabled' : ''}>不出 <kbd>P</kbd></button>
        <button class="button button-primary" data-action="play" ${!controls.playEnabled || snapshot.isBusy ? 'disabled' : ''}>出牌 <kbd>↵</kbd></button>
      </div>`;
  return `<div class="hand-controls">
    <div class="selection-caption"><span>${picked.length ? `已选 ${picked.length} 张` : '点击手牌选择'}</span><span>${snapshot.state.currentPlayer === 0 && snapshot.state.phase === 'RESPONDING' && !snapshot.isBusy ? '可压牌或不出' : ''}</span></div>
    ${actionButtons}
    <p class="inline-error" role="status">${escapeHtml(error)}</p>
  </div>`;
}

function renderResult(snapshot: BrowserSessionSnapshot): string {
  const result = snapshot.viewModel.result;
  if (result === null) return '';
  const order = result.places.map((playerId, index) => `<li><span class="result-place">0${index + 1}</span><span>${playerName(playerId)}</span><i>${playerId % 2 === result.winningTeam ? 'WINNING TEAM' : 'OPPONENT'}</i></li>`).join('');
  return `<div class="modal-scrim"><section class="result-card" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <span class="eyebrow">ROUND COMPLETE · ${formatSeed(result.seed)} · ${deckOption(shownDeckCount(snapshot)).label}</span>
    <h2 id="result-title">${result.winningTeam === 0 ? '蓝队拿下这局' : '金队拿下这局'}</h2>
    <p class="result-subtitle">抓 ${result.capturedOpponents} 人 · 单局结算</p>
    <ol class="result-order">${order}</ol>
    <div class="result-actions"><button class="button button-primary" data-action="replay">同种子重开</button><button class="button button-secondary" data-action="new-game">新开一局</button></div>
  </section></div>`;
}

function renderHelp(): string {
  if (!helpOpen) return '';
  return `<div class="modal-scrim" data-action="close-help">
    <section class="help-card" role="dialog" aria-modal="true" aria-labelledby="help-title" data-dialog>
      <button class="icon-button help-close" data-action="close-help" aria-label="关闭帮助">×</button>
      <span class="eyebrow">QUICK RULES</span><h2 id="help-title">一局 4A4，四人两队</h2>
      <p>座位 0 和 2 为蓝队，座位 1 和 3 为金队。两副牌每人 27 张；一副牌 54 张，每队一人 14 张、一人 13 张。轮流严格压牌或选择不出。</p>
      <div class="rule-grid"><article><b>首家</b><span>持红桃 3 的玩家先出。两副牌时依次比较红桃 3、黑桃 3、梅花 3、方块 3 的张数，多者先出，仍相同时按种子决定。首家可出任意合法牌型。</span></article>
        <article><b>牌型</b><span>单张、对子、单/双/三顺、轰/炸弹、王炸、4A4。一副牌没有 5 张以上的同点数和红桃 4A4。</span></article>
        <article><b>勾岔</b><span>单牌可以被另一人用同点数对子“岔”；岔后才轮到另一人用同点数单牌“勾”，岔、勾交替，不能自己接自己的牌。岔和勾是动作，不是牌型：有人岔过后链条一停，这一轮立刻结束（死岔/死勾），谁也不能再压，最后岔或勾的人接着出牌。一副牌每个点数只有 4 张，单、岔、勾之后链条自然停止。</span></article>
        <article><b>结束</b><span>只剩一人有牌时结算；队友出完顺序决定抓人数。种子可复制分享并复现同一局。</span></article>
      </div>
      <button class="button button-primary" data-action="close-help">明白了</button>
    </section>
  </div>`;
}

function renderDeckChoice(): string {
  const options = DECK_OPTIONS.map((option) => `<label class="deck-option">
      <input type="radio" name="deck" value="${option.deckCount}" ${option.deckCount === chosenDeckCount ? 'checked' : ''} />
      <span class="deck-option-body"><b>${escapeHtml(option.label)}</b><small>${escapeHtml(option.summary)}</small></span>
    </label>`).join('');
  return `<div class="deck-choice" role="radiogroup" aria-labelledby="deck-label">
      <span id="deck-label" class="field-label">牌数 <span>规则、AI 和结算两种都一样</span></span>
      <div class="deck-options">${options}</div>
    </div>`;
}

function renderStart(snapshot: BrowserSessionSnapshot): string {
  if (snapshot.state.phase !== 'SETUP') return '';
  return `<div class="modal-scrim start-scrim"><section class="start-card" role="dialog" aria-modal="true" aria-labelledby="start-title">
    <span class="eyebrow">FOUR PLAYERS · TWO TEAMS · ONE ROUND</span>
    <div class="hero-mark"><span>4</span><i>A</i><span>4</span></div>
    <h1 id="start-title">一局 4A4</h1>
    <p>把注意力留给牌桌。固定 2 对 2，三位基础 AI，完全离线。</p>
    <form id="start-form" class="seed-form">
      ${renderDeckChoice()}
      <label for="seed-input" class="field-label">随机种子 <span>相同种子和牌数会复现相同发牌与 AI 决策</span></label>
      <div class="seed-entry"><span>#</span><input id="seed-input" name="seed" inputmode="numeric" pattern="[0-9]{1,10}" maxlength="10" value="${snapshot.state.rootSeed ?? session.seed}" aria-describedby="seed-error" /></div>
      <p id="seed-error" class="inline-error" role="alert"></p>
      <button class="button button-primary start-button" type="submit">开始练习 <span>→</span></button>
    </form>
    <div class="start-foot"><span data-deck-summary>${escapeHtml(deckOption(chosenDeckCount).summary)}</span><span>规则版本 ${escapeHtml(snapshot.state.rulesVersion)}</span></div>
  </section></div>`;
}

function render(snapshot: BrowserSessionSnapshot): void {
  const state = snapshot.state;
  const started = state.phase !== 'SETUP';
  const seed = state.rootSeed ?? session.seed;
  const disabled = snapshot.isBusy ? 'disabled' : '';
  root!.innerHTML = `<div class="app-frame ${started ? 'has-game' : 'is-idle'}">
    <header class="topbar">
      <a class="brand" href="./" aria-label="4A4 首页"><span class="brand-mark">4A4</span><span class="brand-copy"><b>TABLE / 01</b><small>单局练习版</small></span></a>
      <div class="topbar-center"><span class="live-indicator"></span>OFFLINE PRACTICE <i>·</i> 2V2</div>
      <nav class="top-actions" aria-label="游戏工具">
        <span class="seed-chip" title="固定种子">SEED ${escapeHtml(formatSeed(seed))}</span>
        <button class="icon-button" data-action="help" aria-label="游戏规则" title="游戏规则">?</button>
        <button class="button button-quiet new-game-top" data-action="new-game" ${disabled}>新开一局</button>
      </nav>
    </header>
    <main>
      <div class="table-heading"><div><span class="eyebrow">4A4 · SINGLE ROUND · <span data-deck-label>${deckOption(shownDeckCount(snapshot)).label}</span></span><h2>练习牌桌</h2></div>
        <div class="round-progress"><span>固定队伍</span><b>0 / 2 <i>VS</i> 1 / 3</b></div></div>
      <section class="table-grid" aria-label="4A4 牌桌">
        ${renderSeat('top', snapshot)}
        ${renderSeat('left', snapshot)}
        ${renderCenter(snapshot)}
        ${renderSeat('right', snapshot)}
        <section class="hand-zone" aria-label="玩家手牌">
          <div class="hand-header"><div><span class="eyebrow">YOUR HAND</span><h3>你的手牌 <span>${snapshot.viewModel.seats.bottom.remaining}</span></h3></div>
            <div class="hand-hint">点牌选择 <i>·</i> 按住拖过多张一次选中</div></div>
          <div class="hand-viewport">${renderHand(snapshot)}</div>
          ${renderControls(snapshot)}
        </section>
      </section>
      <footer class="page-footer"><span>纯离线 · 规则由 TypeScript 核心驱动</span><span>BUILD 01 <i>·</i> 4A4</span></footer>
    </main>
    ${renderStart(snapshot)}${renderResult(snapshot)}${renderHelp()}
    <div class="toast ${notice ? 'is-visible' : ''}" role="status" aria-live="polite">${escapeHtml(notice)}</div>
  </div>`;
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
  session = next;
  chosenDeckCount = next.deckCount;
  unsubscribe = session.subscribe(render);
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(next.seed));
  url.searchParams.set('decks', String(next.deckCount));
  window.history.replaceState({}, '', url);
}

function parseInputSeed(input: HTMLInputElement | null): number | null {
  const value = input?.value.trim() ?? '';
  if (!/^\d{1,10}$/.test(value)) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) && seed <= 0xffff_ffff ? seed : null;
}

root.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'start-form') return;
  event.preventDefault();
  const seedInput = form.querySelector<HTMLInputElement>('#seed-input');
  const seed = parseInputSeed(seedInput);
  if (seed === null) {
    const error = form.querySelector<HTMLElement>('#seed-error');
    if (error) error.textContent = '请输入 0 到 4,294,967,295 之间的整数。';
    seedInput?.focus();
    return;
  }
  const deck = form.querySelector<HTMLInputElement>('input[name="deck"]:checked');
  if (deck !== null) chosenDeckCount = deck.value === '1' ? 1 : 2;
  replaceSession(new BrowserGameSession(seed, { deckCount: chosenDeckCount }));
  const started = await session.start();
  if (!started) setNotice(`无法开始游戏：${session.lastErrorCode ?? '未知错误'}`);
});

/**
 * Dragging the mouse (or a pen) across the hand selects every card it passes; starting on a selected card
 * clears them instead. Touch keeps scrolling the hand, which is wider than a phone screen.
 */
let handDrag: { pointer: number; ids: string[]; base: string[]; from: number; to: number; moved: boolean } | null = null;
let suppressCardClickUntil = 0;

function handCardAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('.hand-card[data-card-id]') ?? null;
}

root.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' || event.button !== 0 || !(event.target instanceof Element)) return;
  const card = event.target.closest<HTMLElement>('.hand-card[data-card-id]');
  if (card === null || card.hasAttribute('disabled')) return;
  const ids = [...root.querySelectorAll<HTMLElement>('.hand-card[data-card-id]')].map((element) => element.dataset.cardId ?? '');
  const from = ids.indexOf(card.dataset.cardId ?? '');
  if (from < 0) return;
  event.preventDefault();
  handDrag = { pointer: event.pointerId, ids, base: [...session.selectedCardIds], from, to: from, moved: false };
});

window.addEventListener('pointermove', (event) => {
  const drag = handDrag;
  if (drag === null || drag.pointer !== event.pointerId) return;
  const index = drag.ids.indexOf(handCardAt(event.clientX, event.clientY)?.dataset.cardId ?? '');
  if (index < 0 || index === drag.to) return;
  drag.to = index;
  drag.moved = true;
  session.setSelection(dragSelection(drag.base, drag.ids, drag.from, index));
});

function endHandDrag(event: PointerEvent): void {
  if (handDrag === null || handDrag.pointer !== event.pointerId) return;
  // The click that follows a drag must not toggle the card it ended on.
  if (handDrag.moved) suppressCardClickUntil = performance.now() + 400;
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
    if (performance.now() < suppressCardClickUntil) return;
    const cardId = button.dataset.cardId;
    if (cardId !== undefined) session.toggleCard(cardId);
    return;
  }
  if (action === 'help') { helpOpen = true; render(session.snapshot()); return; }
  if (action === 'close-help') {
    if (target === button || target === button.parentElement) { helpOpen = false; render(session.snapshot()); }
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
    replaceSession(new BrowserGameSession(Date.now() >>> 0, { deckCount: session.deckCount }));
    return;
  }
});

// Switching the version updates its counts in place, so a seed being typed is not re-rendered away.
root.addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.name !== 'deck' || !input.checked) return;
  chosenDeckCount = input.value === '1' ? 1 : 2;
  const option = deckOption(chosenDeckCount);
  root.querySelectorAll('[data-deck-summary]').forEach((element) => { element.textContent = option.summary; });
  root.querySelectorAll('[data-deck-hand]').forEach((element) => { element.textContent = option.handSizeLabel; });
  root.querySelectorAll('[data-deck-label]').forEach((element) => { element.textContent = option.label; });
});

root.addEventListener('keydown', async (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  if (event.target instanceof HTMLInputElement) {
    if (event.key === 'Enter' && event.target.id === 'seed-input') return;
    return;
  }
  if (event.key.toLowerCase() === 'h') session.cycleHint();
  if (event.key.toLowerCase() === 'p') await session.pass();
  if (event.key === 'Enter') await session.playSelection();
  if (event.key === 'Escape' && helpOpen) { helpOpen = false; render(session.snapshot()); }
});

render(session.snapshot());
