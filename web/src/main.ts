import { Card, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck } from '../../client/assets/scripts/core/cards/deck';
import { BrowserGameSession, BrowserSessionSnapshot } from './browser-session';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) throw new Error('Missing #app root');

const allCards = new Map(createDoubleDeck().map((card) => [card.id, card]));
const suitGlyph: Record<Suit, string> = {
  [Suit.CLUB]: '♣',
  [Suit.DIAMOND]: '♦',
  [Suit.HEART]: '♥',
  [Suit.SPADE]: '♠',
  [Suit.JOKER]: '✦',
};

let helpOpen = false;
let notice = '';
let noticeTimer: number | undefined;
let session = new BrowserGameSession(readSeedFromUrl() ?? 414);
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

function formatSeed(seed: number): string {
  return `#${seed.toString().padStart(10, '0')}`;
}

function rankLabel(rank: Rank): string {
  switch (rank) {
    case Rank.THREE: return '3';
    case Rank.FOUR: return '4';
    case Rank.FIVE: return '5';
    case Rank.SIX: return '6';
    case Rank.SEVEN: return '7';
    case Rank.EIGHT: return '8';
    case Rank.NINE: return '9';
    case Rank.TEN: return '10';
    case Rank.JACK: return 'J';
    case Rank.QUEEN: return 'Q';
    case Rank.KING: return 'K';
    case Rank.ACE: return 'A';
    case Rank.TWO: return '2';
    case Rank.SMALL_JOKER: return '小王';
    case Rank.BIG_JOKER: return '大王';
  }
}

function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((left, right) => left.rank - right.rank || left.suit - right.suit || left.deckIndex - right.deckIndex);
}

function playerName(playerId: number): string {
  if (playerId === 0) return '你';
  if (playerId === 2) return '搭档';
  return playerId === 1 ? '左对家' : '右对家';
}

function phaseMessage(snapshot: BrowserSessionSnapshot): string {
  const state = snapshot.state;
  if (state.phase === 'ROUND_RESULT') return '本局结束';
  // A CHA/GOU just happened. Nobody is highlighted: whether anyone is being asked to continue is private.
  const pending = snapshot.viewModel.center.pending;
  if (pending !== null) {
    return `${playerName(pending.playerId)}${pending.addition === 'CHA' ? '岔' : '勾'} ${rankLabel(pending.rank)}，看有没有人接`;
  }
  if (state.phase === 'GOUCHA_QUERY' && state.currentPlayer === 0) {
    const addition = state.trick?.gouCha?.nextAddition;
    return addition === 'CHA' ? '轮到你岔：选同点数的一对牌' : '轮到你勾：选同点数的一张牌';
  }
  if (state.currentPlayer === 0 && state.phase === 'FREE_LEAD') return '轮到你自由出牌';
  if (state.currentPlayer === 0 && state.phase === 'RESPONDING') return '轮到你压牌，或选择不出';
  return state.currentPlayer === null ? '正在准备牌局' : `${playerName(state.currentPlayer)}思考中`;
}

function humanError(snapshot: BrowserSessionSnapshot): string {
  const code = snapshot.viewModel.controls.errorKey ?? snapshot.errorCode;
  if (code === null) return '';
  const messages: Record<string, string> = {
    'selection.empty': '先选择要出的牌。',
    'pattern.mixed_ranks': '对子需要两张同点数牌。',
    'pattern.sequence_too_short': '顺子至少需要连续三张。',
    'pattern.sequence_gap': '顺子点数必须连续。',
    'pattern.sequence_forbidden_rank': '2 和大小王不能加入顺子。',
    'pattern.sequence_multiplicity': '顺子每个点数的张数必须一致。',
    'pattern.unsupported_combination': '这组牌不符合已确认的牌型。',
    'rule.not_current_player': '现在还没有轮到你。',
    'rule.wrong_phase': '当前阶段不能执行这个动作。',
    'rule.does_not_beat_current_play': '这组牌压不过桌面牌。',
    'rule.card_not_owned': '选择的牌已不在你的手牌中。',
    'INVALID_GOUCHA_SELECTION': '请选择符合岔/勾要求的牌。',
  };
  return messages[code] ?? `操作未生效（${code}）`;
}

function renderCard(card: Card, selected: boolean, compact = false): string {
  const red = card.suit === Suit.HEART || card.suit === Suit.DIAMOND || card.rank === Rank.BIG_JOKER;
  const rank = rankLabel(card.rank);
  const glyph = suitGlyph[card.suit];
  const classes = ['playing-card', red ? 'is-red' : '', selected ? 'is-selected' : '', compact ? 'is-compact' : '']
    .filter(Boolean).join(' ');
  return `<span class="${classes}" aria-label="${escapeHtml(rank)}${glyph}">
    <span class="card-corner"><strong>${escapeHtml(rank)}</strong><i>${glyph}</i></span>
    <span class="card-center-suit">${glyph}</span>
    <span class="card-copy">${card.deckIndex === 0 ? 'I' : 'II'}</span>
  </span>`;
}

function renderHand(snapshot: BrowserSessionSnapshot): string {
  const hand = snapshot.viewModel.seats.bottom.cards ?? [];
  if (hand.length === 0) return '<p class="empty-hand">开局后，你的 27 张手牌会在这里显示。</p>';
  const selected = new Set(snapshot.selectedCardIds);
  const prompt = snapshot.viewModel.gouCha;
  const eligible = prompt === null ? null : new Set(prompt.eligibleCardIds);
  return `<div class="hand-track" aria-label="你的手牌">${sortHand(hand).map((card) => {
    const active = selected.has(card.id);
    const ineligible = eligible !== null && !eligible.has(card.id);
    const cardHtml = renderCard(card, active);
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
    return card === undefined ? [] : [renderCard(card, false, true)];
  });
  const holder = center.holderId;
  const history = snapshot.state.publicHistory.slice(-4).reverse().map((entry) => {
    const action = { PLAY_CARDS: '出牌', PASS: '不出', CHA: '岔', GOU: '勾' }[entry.kind];
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
    <div class="selection-caption"><span>${picked.length ? `已选 ${picked.length} 张` : '点击手牌选择'}</span><span>${snapshot.state.currentPlayer === 0 && snapshot.state.phase === 'RESPONDING' ? '可压牌或不出' : ''}</span></div>
    ${actionButtons}
    <p class="inline-error" role="status">${escapeHtml(error)}</p>
  </div>`;
}

function renderResult(snapshot: BrowserSessionSnapshot): string {
  const result = snapshot.viewModel.result;
  if (result === null) return '';
  const order = result.places.map((playerId, index) => `<li><span class="result-place">0${index + 1}</span><span>${playerName(playerId)}</span><i>${playerId % 2 === result.winningTeam ? 'WINNING TEAM' : 'OPPONENT'}</i></li>`).join('');
  return `<div class="modal-scrim"><section class="result-card" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <span class="eyebrow">ROUND COMPLETE · ${formatSeed(result.seed)}</span>
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
      <p>座位 0 和 2 为蓝队，座位 1 和 3 为金队。每人 27 张牌，轮流严格压牌或选择不出。</p>
      <div class="rule-grid"><article><b>牌型</b><span>单张、对子、单/双/三顺、轰/炸弹、王炸、4A4。</span></article>
        <article><b>勾岔</b><span>单牌可以被另一人用同点数对子“岔”；岔后才轮到另一人用同点数单牌“勾”，岔、勾交替，不能自己接自己的牌。岔和勾是动作，不是牌型：有人岔过后链条一停，这一轮立刻结束（死岔/死勾），谁也不能再压，最后岔或勾的人接着出牌。</span></article>
        <article><b>结束</b><span>只剩一人有牌时结算；队友出完顺序决定抓人数。种子可复制分享并复现同一局。</span></article>
      </div>
      <button class="button button-primary" data-action="close-help">明白了</button>
    </section>
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
      <label for="seed-input">随机种子 <span>相同种子会复现相同发牌与 AI 决策</span></label>
      <div class="seed-entry"><span>#</span><input id="seed-input" name="seed" inputmode="numeric" pattern="[0-9]{1,10}" maxlength="10" value="${snapshot.state.rootSeed ?? session.seed}" aria-describedby="seed-error" /></div>
      <p id="seed-error" class="inline-error" role="alert"></p>
      <button class="button button-primary start-button" type="submit">开始练习 <span>→</span></button>
    </form>
    <div class="start-foot"><span>108 张牌 · 每人 27 张</span><span>规则版本 ${escapeHtml(snapshot.state.rulesVersion)}</span></div>
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
      <div class="table-heading"><div><span class="eyebrow">4A4 · SINGLE ROUND</span><h2>练习牌桌</h2></div>
        <div class="round-progress"><span>固定队伍</span><b>0 / 2 <i>VS</i> 1 / 3</b></div></div>
      <section class="table-grid" aria-label="4A4 牌桌">
        ${renderSeat('top', snapshot)}
        ${renderSeat('left', snapshot)}
        ${renderCenter(snapshot)}
        ${renderSeat('right', snapshot)}
        <section class="hand-zone" aria-label="玩家手牌">
          <div class="hand-header"><div><span class="eyebrow">YOUR HAND</span><h3>你的手牌 <span>${snapshot.viewModel.seats.bottom.remaining}</span></h3></div>
            <div class="hand-hint">选中牌面加入组合 <i>·</i> 同点数牌会自动对齐</div></div>
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

function replaceSession(seed: number): void {
  unsubscribe();
  helpOpen = false;
  session = new BrowserGameSession(seed);
  unsubscribe = session.subscribe(render);
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
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
  replaceSession(seed);
  const started = await session.start();
  if (!started) setNotice(`无法开始游戏：${session.lastErrorCode ?? '未知错误'}`);
});

root.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>('[data-action]');
  if (button === null || button.hasAttribute('disabled')) return;
  const action = button.dataset.action;
  if (action === 'toggle-card') {
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
    replaceSession(session.seed);
    await session.start();
    return;
  }
  if (action === 'new-game') {
    replaceSession(Date.now() >>> 0);
    return;
  }
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
