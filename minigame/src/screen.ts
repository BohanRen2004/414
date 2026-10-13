import { Card, PlayerId, TeamId } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck, DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { deckOption } from '../../client/assets/scripts/ui/deck-options';
import {
  HISTORY_ACTION_LABEL, errorMessage, formatSeed, phaseMessage, playerName, rankLabel, sortCardsForDisplay,
} from '../../client/assets/scripts/ui/labels';
import { BrowserSessionSnapshot } from '../../web/src/browser-session';

/** Everything the canvas draws, as plain data: built from a session snapshot, drawn by render.ts. */

export type ActionId =
  | 'hint' | 'clear' | 'pass' | 'play' | 'confirm-goucha' | 'decline-goucha'
  | 'replay' | 'new-game' | 'help' | 'close-help' | 'start' | 'deck-1' | 'deck-2';

export type SeatPosition = 'top' | 'left' | 'right' | 'bottom';

export interface SeatScreen {
  readonly position: SeatPosition;
  readonly playerId: PlayerId;
  readonly name: string;
  readonly team: TeamId;
  readonly remaining: number;
  readonly report: number | null;
  readonly place: number | null;
  readonly active: boolean;
}

export interface ButtonScreen {
  readonly id: ActionId;
  readonly label: string;
  readonly enabled: boolean;
  readonly style: 'primary' | 'secondary' | 'quiet';
}

export interface HandScreen {
  readonly cards: readonly Card[];
  readonly selected: ReadonlySet<string>;
  /** During the human's own CHA/GOU prompt, only these cards can be picked; null otherwise. */
  readonly eligible: ReadonlySet<string> | null;
  readonly enabled: boolean;
}

export interface ResultScreen {
  readonly title: string;
  readonly subtitle: string;
  readonly places: readonly { readonly name: string; readonly winning: boolean }[];
}

export interface StartScreen {
  readonly deckCount: DeckCount;
  readonly summary: string;
}

export interface TableScreen {
  readonly topLabel: string;
  readonly seedLabel: string;
  readonly seats: readonly SeatScreen[];
  readonly center: {
    readonly headline: string;
    readonly cards: readonly Card[];
    readonly holderLine: string;
    readonly detail: string;
  };
  readonly status: { readonly text: string; readonly forHuman: boolean };
  readonly history: readonly string[];
  readonly hand: HandScreen;
  readonly caption: string;
  readonly error: string;
  readonly buttons: readonly ButtonScreen[];
  readonly start: StartScreen | null;
  readonly result: ResultScreen | null;
  /** Whether cards show their deck copy mark (I/II); only meaningful with two decks. */
  readonly showCopy: boolean;
}

// One deck uses the same card IDs as the first of two decks, so this map serves both versions.
const ALL_CARDS = new Map(createDoubleDeck().map((card) => [card.id, card]));

const POSITIONS: readonly SeatPosition[] = ['top', 'left', 'right', 'bottom'];

function playButtons(snapshot: BrowserSessionSnapshot): ButtonScreen[] {
  const busy = snapshot.isBusy;
  const prompt = snapshot.viewModel.gouCha;
  const picked = snapshot.selectedCardIds;
  if (prompt !== null) {
    const eligible = new Set(prompt.eligibleCardIds);
    const valid = picked.length === prompt.requiredCount && picked.every((id) => eligible.has(id));
    const verb = prompt.addition === 'CHA' ? '岔' : '勾';
    return [
      { id: 'decline-goucha', label: '放弃', enabled: !busy, style: 'quiet' },
      { id: 'confirm-goucha', label: `确认${verb}`, enabled: valid && !busy, style: 'primary' },
    ];
  }
  const controls = snapshot.viewModel.controls;
  return [
    { id: 'clear', label: '清除', enabled: picked.length > 0 && !busy, style: 'quiet' },
    { id: 'hint', label: '提示', enabled: controls.showHint && !busy, style: 'quiet' },
    { id: 'pass', label: '不出', enabled: controls.showPass && !busy, style: 'secondary' },
    { id: 'play', label: '出牌', enabled: controls.playEnabled && !busy, style: 'primary' },
  ];
}

/** Build the screen for one session snapshot; `chosenDeckCount` is the version picked on the start screen. */
export function buildTableScreen(snapshot: BrowserSessionSnapshot, chosenDeckCount: DeckCount, seed: number): TableScreen {
  const { state, viewModel } = snapshot;
  const deckCount = state.deckCount ?? chosenDeckCount;
  const option = deckOption(deckCount);
  const seats = POSITIONS.map((position): SeatScreen => {
    const seat = viewModel.seats[position];
    return {
      position,
      playerId: seat.playerId,
      name: playerName(seat.playerId),
      team: seat.teamId,
      remaining: seat.remaining,
      report: seat.reportCount,
      place: seat.finishPlace,
      active: state.currentPlayer === seat.playerId,
    };
  });

  const center = viewModel.center;
  // CHA/GOU are actions on the single, so a chain reads like "单 6 · 左对家岔 · 你勾".
  const actions = center.contributions.filter((part) => part.label !== '出牌').map((part) => `${playerName(part.playerId)}${part.label}`);
  const leads = center.contributions.filter((part) => part.label === '出牌').map((part) => `${playerName(part.playerId)}出牌`);
  const prompt = viewModel.gouCha;
  const picked = snapshot.selectedCardIds;

  const result = viewModel.result === null ? null : {
    title: viewModel.result.winningTeam === 0 ? '蓝队拿下这局' : '金队拿下这局',
    subtitle: `抓 ${viewModel.result.capturedOpponents} 人 · ${option.label} · 种子 ${formatSeed(viewModel.result.seed)}`,
    places: viewModel.result.places.map((playerId) => ({
      name: playerName(playerId),
      winning: playerId % 2 === viewModel.result!.winningTeam,
    })),
  };

  return {
    topLabel: `4A4 · ${option.label}`,
    seedLabel: `种子 ${formatSeed(state.rootSeed ?? seed)}`,
    seats,
    center: {
      headline: [center.patternLabel, ...actions].join(' · '),
      cards: center.cardIds.flatMap((id) => {
        const card = ALL_CARDS.get(id);
        return card === undefined ? [] : [card];
      }),
      holderLine: center.holderId === null ? '等待首手出牌' : `当前持有：${playerName(center.holderId)}`,
      detail: leads.join(' · '),
    },
    status: {
      text: phaseMessage(state, viewModel, snapshot.isBusy),
      forHuman: state.currentPlayer === 0 && !snapshot.isBusy,
    },
    history: state.publicHistory.slice(-4).reverse()
      .map((entry) => `${playerName(entry.playerId)} ${HISTORY_ACTION_LABEL[entry.kind]}`),
    hand: {
      cards: sortCardsForDisplay(viewModel.seats.bottom.cards ?? []),
      selected: new Set(picked),
      eligible: prompt === null ? null : new Set(prompt.eligibleCardIds),
      enabled: !snapshot.isBusy && state.phase !== 'SETUP' && state.phase !== 'ROUND_RESULT',
    },
    caption: prompt !== null
      ? `${prompt.addition === 'CHA' ? '岔' : '勾'} ${rankLabel(prompt.rank)}：${prompt.addition === 'CHA' ? '选两张同点数的牌' : '选一张同点数的牌'}`
      : picked.length > 0 ? `已选 ${picked.length} 张` : '点手牌选择',
    error: errorMessage(viewModel.controls.errorKey ?? snapshot.errorCode),
    buttons: state.phase === 'SETUP' || state.phase === 'ROUND_RESULT' ? [] : playButtons(snapshot),
    start: state.phase === 'SETUP' ? { deckCount, summary: option.summary } : null,
    result,
    showCopy: deckCount === 2,
  };
}
