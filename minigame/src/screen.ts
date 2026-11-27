import { Card, PlayerId, TeamId } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck, DeckCount, PlayerCount } from '../../client/assets/scripts/core/cards/deck';
import { deckOption, playerOption } from '../../client/assets/scripts/ui/deck-options';
import {
  HISTORY_ACTION_LABEL, errorMessage, formatSeed, phaseMessage, playerName, rankLabel, sortCardsForDisplay,
} from '../../client/assets/scripts/ui/labels';
import { RoomView } from '../../client/assets/scripts/online/protocol';
import { BrowserSessionSnapshot } from '../../web/src/browser-session';

/** Everything the canvas draws, as plain data: built from a session snapshot, drawn by render.ts. */

export type ActionId =
  | 'hint' | 'clear' | 'pass' | 'play' | 'confirm-goucha' | 'decline-goucha'
  | 'replay' | 'new-game' | 'help' | 'close-help' | 'start' | 'deck-1' | 'deck-2'
  | 'players-2' | 'players-3' | 'players-4'
  // Online play.
  | 'create-room' | 'join-room' | 'invite' | 'leave-room' | 'start-online' | 'room-lobby'
  | 'auto-on' | 'auto-off' | 'seat-0' | 'seat-1' | 'seat-2' | 'seat-3'
  // Table tools.
  | 'counter' | 'sound';

export type SeatPosition = 'top' | 'left' | 'right' | 'bottom';

export interface SeatScreen {
  readonly position: SeatPosition;
  readonly playerId: PlayerId;
  readonly name: string;
  /** One or two characters in the seat's avatar circle. */
  readonly badge: string;
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

/** One seat's latest action in the current trick, drawn in front of that seat. */
export interface ZoneScreen {
  readonly kind: 'PLAY' | 'PASS' | 'CHA' | 'GOU';
  readonly cards: readonly Card[];
  readonly label: string;
  /** The play to beat. */
  readonly leading: boolean;
  readonly bomb: boolean;
  /** Public action number: a new key means a new action to animate. */
  readonly key: number;
}

export interface CounterScreen {
  /** Whose cards the counts are: "三家还剩", or with two players "对手或扣牌". */
  readonly subtitle: string;
  readonly entries: readonly { readonly label: string; readonly unseen: number }[];
}

/** Table tools the app keeps outside the game session. */
export interface TableUi {
  readonly counterOpen?: boolean;
  /** The table size picked for the next offline game. */
  readonly playerCount?: PlayerCount;
  readonly muted?: boolean;
}

export interface ResultScreen {
  readonly title: string;
  readonly subtitle: string;
  readonly places: readonly { readonly name: string; readonly winning: boolean }[];
  readonly buttons: readonly ButtonScreen[];
  /** A line above the buttons, e.g. who decides on the next game. */
  readonly note: string;
}

export interface StartScreen {
  readonly playerCount: PlayerCount;
  readonly deckCount: DeckCount;
  readonly summary: string;
  /** Whether the create/join room buttons are offered (cloud development is available). */
  readonly online: boolean;
}

export interface TableScreen {
  readonly topLabel: string;
  readonly seedLabel: string;
  readonly topButtons: readonly ButtonScreen[];
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
  /** Two decks: the hand sits in columns by rank; one deck: one row. */
  readonly handColumns: boolean;
  readonly zones: Readonly<Record<SeatPosition, ZoneScreen | null>>;
  readonly counter: CounterScreen | null;
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

/** What an online table adds to the screen: the room and the viewer's clock and 托管 state. */
export interface OnlineTableInfo {
  readonly room: RoomView;
  readonly secondsLeft: number | null;
  readonly auto: boolean;
}

/** Seat names online: "你", a friend's nickname, or the AI by where it sits. */
function onlineName(room: RoomView, viewerId: PlayerId, playerCount: number): (playerId: PlayerId) => string {
  return (playerId) => {
    const seat = room.seats[playerId];
    if (playerId === viewerId) return '你';
    if (seat.kind === 'human') return seat.name;
    const offset = (playerId - viewerId + playerCount) % playerCount;
    if (playerCount === 2) return '对手AI';
    if (playerCount === 3) return offset === 1 ? '左家AI' : '右家AI';
    return offset === 2 ? '搭档AI' : offset === 1 ? '左家AI' : '右家AI';
  };
}

function playButtons(snapshot: BrowserSessionSnapshot): ButtonScreen[] {
  const busy = snapshot.isBusy;
  const prompt = snapshot.viewModel.gouCha;
  const picked = snapshot.selectedCardIds;
  if (prompt !== null) {
    const eligible = new Set(prompt.eligibleCardIds);
    const valid = picked.length === prompt.requiredCount && picked.every((id) => eligible.has(id));
    const verb = prompt.addition === 'CHA' ? '岔' : '勾';
    return [
      { id: 'decline-goucha', label: '放弃', enabled: !busy, style: 'secondary' },
      { id: 'confirm-goucha', label: `确认${verb}`, enabled: valid && !busy, style: 'primary' },
    ];
  }
  const controls = snapshot.viewModel.controls;
  // Buttons only show on the player's own turn, like a card room's action bar.
  if (!controls.showPlay) return [];
  return [
    { id: 'clear', label: '清除', enabled: picked.length > 0 && !busy, style: 'quiet' },
    { id: 'hint', label: '提示', enabled: controls.showHint && !busy, style: 'quiet' },
    { id: 'pass', label: '不出', enabled: controls.showPass && !busy, style: 'secondary' },
    { id: 'play', label: '出牌', enabled: controls.playEnabled && !busy, style: 'primary' },
  ];
}

/** Build the screen for one session snapshot; `chosenDeckCount` is the version picked on the start screen. */
export function buildTableScreen(
  snapshot: BrowserSessionSnapshot,
  chosenDeckCount: DeckCount,
  seed: number,
  online: OnlineTableInfo | null = null,
  canGoOnline = false,
  ui: TableUi = {},
): TableScreen {
  const { state, viewModel } = snapshot;
  const deckCount = state.deckCount ?? chosenDeckCount;
  const option = deckOption(deckCount);
  const viewerId = viewModel.seats.bottom.playerId;
  const players = state.playerCount;
  const teams = players === 4;
  const name = online === null ? (playerId: PlayerId) => playerName(playerId, players) : onlineName(online.room, viewerId, players);
  const seats = POSITIONS.flatMap((position): SeatScreen[] => {
    const seat = viewModel.seats[position];
    if (seat === null) return [];
    const occupant = online?.room.seats[seat.playerId];
    return [{
      position,
      playerId: seat.playerId,
      name: name(seat.playerId),
      badge: occupant === undefined ? (position === 'top' && teams ? '搭' : 'AI')
        : occupant.kind === 'human' ? [...occupant.name][0] ?? '?' : 'AI',
      team: seat.teamId,
      remaining: seat.remaining,
      report: seat.reportCount,
      place: seat.finishPlace,
      active: state.currentPlayer === seat.playerId,
    }];
  });

  const center = viewModel.center;
  // CHA/GOU are actions on the single, so a chain reads like "单 6 · 左对家岔 · 你勾".
  const actions = center.contributions.filter((part) => part.label !== '出牌').map((part) => `${name(part.playerId)}${part.label}`);
  const leads = center.contributions.filter((part) => part.label === '出牌').map((part) => `${name(part.playerId)}出牌`);
  const prompt = viewModel.gouCha;
  const picked = snapshot.selectedCardIds;

  const finished = viewModel.result;
  const result: ResultScreen | null = finished === null ? null : {
    title: !teams
      ? (finished.places[0] === viewerId ? '你赢了这局' : `${name(finished.places[0]!)}先出完`)
      : online === null
        ? (finished.winningTeam === 0 ? '蓝队拿下这局' : '金队拿下这局')
        : (finished.winningTeam === viewerId % 2 ? '你们队拿下这局' : '对方拿下这局'),
    subtitle: teams
      ? `抓 ${finished.capturedOpponents} 人 · ${option.label} · 种子 ${formatSeed(finished.seed)}`
      : `${players} 人 · 一副牌 · 种子 ${formatSeed(finished.seed)}`,
    places: finished.places.map((playerId, index) => ({
      name: name(playerId),
      winning: teams ? playerId % 2 === finished.winningTeam : index === 0,
    })),
    buttons: online === null
      ? [
          { id: 'replay', label: '同种子重开', enabled: true, style: 'secondary' },
          { id: 'new-game', label: '新开一局', enabled: true, style: 'primary' },
        ]
      : [
          { id: 'leave-room', label: '离开房间', enabled: !snapshot.isBusy, style: 'secondary' },
          ...(online.room.isHost ? [{ id: 'room-lobby', label: '回到房间', enabled: !snapshot.isBusy, style: 'primary' } as const] : []),
        ],
    note: online !== null && !online.room.isHost ? '等房主回到房间开下一局' : '',
  };
  const status = phaseMessage(state, viewModel, snapshot.isBusy, name, viewerId);
  const clock = online?.secondsLeft ?? null;

  const started = state.phase !== 'SETUP';
  const tools: ButtonScreen[] = [
    { id: 'counter', label: '记牌器', enabled: started, style: ui.counterOpen === true ? 'primary' : 'quiet' },
    { id: 'sound', label: ui.muted === true ? '音效 关' : '音效 开', enabled: true, style: 'quiet' },
    { id: 'help', label: '规则', enabled: true, style: 'quiet' },
  ];
  const topButtons: ButtonScreen[] = online === null
    ? [
        ...tools,
        { id: 'new-game', label: '新局', enabled: started, style: 'quiet' },
      ]
    : [
        ...tools,
        online.auto
          ? { id: 'auto-off', label: '取消托管', enabled: !snapshot.isBusy, style: 'primary' }
          : { id: 'auto-on', label: '托管', enabled: !snapshot.isBusy && state.phase !== 'ROUND_RESULT', style: 'quiet' },
        { id: 'leave-room', label: '离开', enabled: !snapshot.isBusy, style: 'quiet' },
      ];
  return {
    topLabel: online === null ? `4A4 · ${players} 人 · ${option.label}` : `4A4 · 房间 ${online.room.code}`,
    seedLabel: online === null ? `种子 ${formatSeed(state.rootSeed ?? seed)}` : option.label,
    topButtons,
    seats,
    center: {
      headline: [center.patternLabel, ...actions].join(' · '),
      cards: center.cardIds.flatMap((id) => {
        const card = ALL_CARDS.get(id);
        return card === undefined ? [] : [card];
      }),
      holderLine: center.holderId === null ? '等待首手出牌' : `当前持有：${name(center.holderId)}`,
      detail: leads.join(' · '),
    },
    status: {
      text: clock !== null && state.currentPlayer === viewerId ? `${status} · 还剩 ${clock} 秒` : status,
      forHuman: state.currentPlayer === viewerId && !snapshot.isBusy,
    },
    history: state.publicHistory.slice(-4).reverse()
      .map((entry) => `${name(entry.playerId)} ${HISTORY_ACTION_LABEL[entry.kind]}`),
    hand: {
      cards: sortCardsForDisplay(viewModel.seats.bottom.cards ?? []),
      selected: new Set(picked),
      eligible: prompt === null ? null : new Set(prompt.eligibleCardIds),
      enabled: !snapshot.isBusy && state.phase !== 'SETUP' && state.phase !== 'ROUND_RESULT' && online?.auto !== true,
    },
    handColumns: deckCount === 2,
    zones: Object.fromEntries(POSITIONS.map((position) => {
      const action = viewModel.seatActions[position];
      return [position, action === null ? null : {
        kind: action.kind,
        cards: action.cardIds.flatMap((id) => {
          const card = ALL_CARDS.get(id);
          return card === undefined ? [] : [card];
        }),
        label: action.label,
        leading: action.leading,
        bomb: action.bomb,
        key: action.key,
      }];
    })) as unknown as TableScreen['zones'],
    counter: ui.counterOpen === true && started
      ? {
          subtitle: players === 2 ? '对手或扣牌' : players === 3 ? '两家还剩' : '三家还剩',
          entries: viewModel.cardCounter.map((entry) => ({ label: entry.label, unseen: entry.unseen })),
        }
      : null,
    caption: online?.auto === true ? '托管中：AI 正在替你出牌，点「取消托管」接回' : prompt !== null
      ? `${prompt.addition === 'CHA' ? '岔' : '勾'} ${rankLabel(prompt.rank)}：${prompt.addition === 'CHA' ? '选两张同点数的牌' : '选一张同点数的牌'}`
      : picked.length > 0 ? `已选 ${picked.length} 张` : '点手牌选择',
    // Picking cards before one's turn is fine; the play button simply stays off until then.
    error: errorMessage((viewModel.controls.errorKey === 'rule.not_current_player' ? null : viewModel.controls.errorKey) ?? snapshot.errorCode),
    buttons: state.phase === 'SETUP' || state.phase === 'ROUND_RESULT' || online?.auto === true ? [] : playButtons(snapshot),
    start: state.phase === 'SETUP' && online === null
      ? { playerCount: ui.playerCount ?? 4, deckCount, summary: (ui.playerCount ?? 4) === 4 ? option.summary : playerOption(ui.playerCount!).summary, online: canGoOnline }
      : null,
    result,
    showCopy: deckCount === 2,
  };
}

// --- Online lobby -----------------------------------------------------------------------------------------

export interface LobbySeatScreen {
  readonly seat: PlayerId;
  readonly team: TeamId;
  /** "你", a nickname, or "空位". */
  readonly label: string;
  readonly detail: string;
  readonly isMe: boolean;
  readonly empty: boolean;
  /** Tapping moves the viewer here. */
  readonly action: ActionId | null;
}

export interface LobbyScreen {
  readonly title: string;
  readonly subtitle: string;
  readonly seats: readonly LobbySeatScreen[];
  readonly deckCount: DeckCount;
  readonly playerCount: PlayerCount;
  /** Whether the viewer may change the table size and deck version (the host). */
  readonly deckEditable: boolean;
  readonly buttons: readonly ButtonScreen[];
  readonly note: string;
  readonly error: string;
}

const SEAT_ACTIONS = ['seat-0', 'seat-1', 'seat-2', 'seat-3'] as const satisfies readonly ActionId[];

/** The room before a game: who sits where (teams are seats 1+3 and 2+4), the version, and the host's start button. */
export function buildLobbyScreen(room: RoomView, isBusy: boolean, errorCode: string | null): LobbyScreen {
  const size = room.playerCount;
  const teams = size === 4;
  const option = deckOption(teams ? room.deckCount : 1);
  const humans = room.seats.filter((seat) => seat.kind === 'human').length;
  const seats = room.seats.slice(0, size).map((seat, index): LobbySeatScreen => {
    const playerId = index as PlayerId;
    const empty = seat.kind === 'empty';
    return {
      seat: playerId,
      team: (teams ? playerId % 2 : playerId) as TeamId,
      label: seat.isMe ? `你（${seat.name}）` : empty ? '空位' : seat.name,
      detail: [seat.isHost ? '房主' : '', empty ? (room.mySeat === null ? '开局时 AI 补位' : '点这里换座 · 开局时 AI 补位') : ''].filter(Boolean).join(' · '),
      isMe: seat.isMe,
      empty,
      action: empty && room.mySeat !== null && !isBusy ? SEAT_ACTIONS[playerId] : null,
    };
  });
  return {
    title: `房间 ${room.code}`,
    subtitle: `${size} 人 · ${teams ? `${option.label} · ${option.summary}` : playerOption(size).summary} · 已到 ${humans} 位`,
    seats,
    deckCount: room.deckCount,
    playerCount: size,
    deckEditable: room.isHost && !isBusy,
    buttons: [
      { id: 'leave-room', label: '离开', enabled: !isBusy, style: 'quiet' },
      { id: 'invite', label: '邀请好友', enabled: !isBusy && humans < size, style: 'secondary' },
      ...(room.isHost ? [{ id: 'start-online', label: humans < size ? '开始（AI 补位）' : '开始', enabled: !isBusy, style: 'primary' } as const] : []),
    ],
    note: teams
      ? (room.isHost ? '同队的人坐对面：1 号和 3 号一队，2 号和 4 号一队。' : '等房主开始。同队的人坐对面。')
      : (room.isHost ? '各打各的，一副牌，谁先出完谁赢。' : '等房主开始。各打各的，谁先出完谁赢。'),
    error: errorMessage(errorCode),
  };
}
