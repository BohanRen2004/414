import { Card, PlayerId, Rank, TeamId } from '../core/cards/card';
import { DEFAULT_DECK_COUNT, createDeck } from '../core/cards/deck';
import { beats } from '../core/patterns/compare';
import { recognize } from '../core/patterns/recognize';
import { PatternErrorCode, PlayPattern } from '../core/patterns/play-pattern';
import { gouChaCardIds } from '../core/rules/goucha';
import { GameState, PublicActionRecord } from '../core/state/game-state';
import { ResultViewModel, buildResultViewModel } from './result-view-model';

export interface HumanUiState {
  readonly humanPlayerId: PlayerId;
  readonly selectedCardIds: readonly string[];
  readonly hintIndex: number;
}

export interface SeatViewModel {
  readonly playerId: PlayerId;
  readonly teamId: TeamId;
  readonly remaining: number;
  readonly finishPlace: number | null;
  readonly reportCount: 1 | 2 | 3 | null;
  readonly cards?: readonly Card[];
}

export interface ContributionViewModel {
  readonly playerId: PlayerId;
  readonly label: '出牌' | '岔' | '勾';
  readonly cardIds: readonly string[];
}

/**
 * A CHA/GOU just happened and the chain may continue. Nobody is shown as acting: whether anyone is
 * being asked depends on hidden hands, so the table only says who added what.
 */
export interface GouChaPendingViewModel {
  /** The latest contributor, who holds the chain. */
  readonly playerId: PlayerId;
  readonly addition: 'CHA' | 'GOU';
  readonly rank: Rank;
}

export interface GouChaPromptViewModel {
  readonly playerId: PlayerId;
  readonly addition: 'CHA' | 'GOU';
  readonly rank: Rank;
  readonly requiredCount: 1 | 2;
  readonly suggestedCardIds: readonly string[];
  readonly eligibleCardIds: readonly string[];
}

export type { ResultViewModel } from './result-view-model';

/** What one seat last did in the current trick, shown in front of that seat. */
export interface SeatActionViewModel {
  readonly kind: 'PLAY' | 'PASS' | 'CHA' | 'GOU';
  /** Cards put down (none for a pass). */
  readonly cardIds: readonly string[];
  /** e.g. "对 K", "炸弹", "不出", "岔", "勾". */
  readonly label: string;
  /** This is the play everyone must beat (the trick's current play). */
  readonly leading: boolean;
  /** The public action number, so a front end can tell a new action from one already shown. */
  readonly key: number;
  /** A 轰, 炸弹, 王炸 or 4A4: worth a louder effect. */
  readonly bomb: boolean;
}

/** 记牌器: how many of each rank the other three seats can still hold (all copies minus played and own). */
export interface CardCounterEntry {
  readonly rank: Rank;
  readonly label: string;
  readonly unseen: number;
}

type SeatPosition = 'bottom' | 'top' | 'left' | 'right';

/**
 * Where each seat sits from the viewer's chair, clockwise from the bottom: four players use bottom, left, top
 * and right; three use bottom, left and right; two sit face to face, bottom and top.
 */
export function seatPositions(viewerId: PlayerId, playerCount: number): Readonly<Partial<Record<SeatPosition, PlayerId>>> {
  const order: readonly SeatPosition[] = playerCount === 2 ? ['bottom', 'top'] : playerCount === 3 ? ['bottom', 'left', 'right'] : ['bottom', 'left', 'top', 'right'];
  return Object.fromEntries(order.map((position, offset) => [position, ((viewerId + offset) % playerCount) as PlayerId]));
}

export interface TableViewModel {
  /** The viewer at the bottom; positions nobody sits at (two or three players) are null. */
  readonly seats: Readonly<{ bottom: SeatViewModel } & Record<Exclude<SeatPosition, 'bottom'>, SeatViewModel | null>>;
  readonly playerCount: number;
  /** Each seat's latest action in the current trick; null before it acted or when no trick is open. */
  readonly seatActions: Readonly<Record<SeatPosition, SeatActionViewModel | null>>;
  readonly cardCounter: readonly CardCounterEntry[];
  readonly center: {
    /** The pattern to beat. A gou-cha chain is labelled by its single: CHA/GOU are actions, not a 轰 or 炸弹. */
    readonly patternLabel: string;
    readonly holderId: PlayerId | null;
    /** Cards on the table: the current play, or a chain's single followed by every CHA/GOU card. */
    readonly cardIds: readonly string[];
    readonly contributions: readonly ContributionViewModel[];
    readonly pending: GouChaPendingViewModel | null;
  };
  readonly controls: {
    readonly showPlay: boolean;
    readonly showPass: boolean;
    readonly showHint: boolean;
    readonly playEnabled: boolean;
    readonly errorKey: string | null;
  };
  readonly gouCha: GouChaPromptViewModel | null;
  readonly result: ResultViewModel | null;
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

function describePattern(pattern: PlayPattern | null, phase: GameState['phase']): string {
  if (pattern === null) return phase === 'FREE_LEAD' ? '自由出牌' : '等待出牌';
  switch (pattern.kind) {
    case 'SINGLE': return `单 ${rankLabel(pattern.rank)}`;
    case 'PAIR': return `对 ${rankLabel(pattern.rank)}`;
    case 'STRAIGHT': return `${pattern.runLength} 张单顺`;
    case 'DOUBLE_STRAIGHT': return `${pattern.runLength * 2} 张双顺`;
    case 'TRIPLE_STRAIGHT': return `${pattern.runLength * 3} 张三顺`;
    case 'N_OF_KIND_BOMB':
      if (pattern.count === 3) return '轰';
      if (pattern.count === 4) return '炸弹';
      return `${pattern.count} 个 ${rankLabel(pattern.rank)}`;
    case 'JOKER_BOMB': return '王炸';
    case 'FOUR_A_FOUR': return pattern.allHearts ? '红桃 4A4' : '4A4';
    case 'INVALID': return '非法牌型';
  }
}

function contributionLabel(kind: PublicActionRecord['kind']): ContributionViewModel['label'] | null {
  if (kind === 'PLAY_CARDS') return '出牌';
  if (kind === 'CHA') return '岔';
  if (kind === 'GOU') return '勾';
  return null;
}

function tableCardIds(state: GameState): readonly string[] {
  const trick = state.trick;
  if (trick === null) return [];
  return trick.gouCha === null ? trick.currentPlay.cardIds : gouChaCardIds(trick.gouCha);
}

function buildContributions(state: GameState, cardIds: readonly string[]): ContributionViewModel[] {
  if (cardIds.length === 0) return [];
  const visibleIds = new Set(cardIds);
  return state.publicHistory.flatMap((record) => {
    const label = contributionLabel(record.kind);
    if (label === null || !record.cardIds.some((id) => visibleIds.has(id))) return [];
    return [{ playerId: record.playerId, label, cardIds: [...record.cardIds] }];
  });
}

function patternErrorKey(code: PatternErrorCode): string {
  switch (code) {
    case 'EMPTY': return 'selection.empty';
    case 'DUPLICATE_CARD_ID': return 'rule.duplicate_card_id';
    case 'MIXED_RANKS': return 'pattern.mixed_ranks';
    case 'SEQUENCE_TOO_SHORT': return 'pattern.sequence_too_short';
    case 'SEQUENCE_GAP': return 'pattern.sequence_gap';
    case 'SEQUENCE_FORBIDDEN_RANK': return 'pattern.sequence_forbidden_rank';
    case 'SEQUENCE_MULTIPLICITY': return 'pattern.sequence_multiplicity';
    case 'UNSUPPORTED_COMBINATION': return 'pattern.unsupported_combination';
  }
}

function selectedPlayStatus(state: GameState, input: HumanUiState): { readonly enabled: boolean; readonly errorKey: string | null } {
  if (input.selectedCardIds.length === 0) return { enabled: false, errorKey: null };
  if (state.currentPlayer !== input.humanPlayerId) return { enabled: false, errorKey: 'rule.not_current_player' };
  // A gou-cha prompt validates its own selection; the play controls are simply not in use.
  if (state.phase === 'GOUCHA_QUERY') return { enabled: false, errorKey: null };
  if (state.phase !== 'FREE_LEAD' && state.phase !== 'RESPONDING') {
    return { enabled: false, errorKey: 'rule.wrong_phase' };
  }
  if (new Set(input.selectedCardIds).size !== input.selectedCardIds.length) {
    return { enabled: false, errorKey: 'rule.duplicate_card_id' };
  }
  const hand = state.players[input.humanPlayerId]!.hand;
  const cards = input.selectedCardIds.map((id) => hand.find((card) => card.id === id));
  if (cards.some((card) => card === undefined)) return { enabled: false, errorKey: 'rule.card_not_owned' };
  const pattern = recognize(cards as Card[]);
  if (pattern.kind === 'INVALID') return { enabled: false, errorKey: patternErrorKey(pattern.reason) };
  if (state.phase === 'RESPONDING') {
    const current = state.trick?.currentPlay;
    if (current === undefined || !beats(pattern, current.pattern)) {
      return { enabled: false, errorKey: 'rule.does_not_beat_current_play' };
    }
  }
  return { enabled: true, errorKey: null };
}

function buildGouChaPrompt(state: GameState, input: HumanUiState): GouChaPromptViewModel | null {
  const chain = state.trick?.gouCha;
  if (state.phase !== 'GOUCHA_QUERY' || chain === null || chain === undefined
    || state.currentPlayer !== input.humanPlayerId) return null;
  const requiredCount = chain.nextAddition === 'CHA' ? 2 : 1;
  const matching = state.players[input.humanPlayerId]!.hand
    .filter((card) => card.rank === chain.rank);
  return {
    playerId: input.humanPlayerId,
    addition: chain.nextAddition,
    rank: chain.rank,
    requiredCount,
    suggestedCardIds: matching.slice(0, requiredCount).map((card) => card.id),
    eligibleCardIds: matching.map((card) => card.id),
  };
}

function buildPending(state: GameState, input: HumanUiState): GouChaPendingViewModel | null {
  const chain = state.trick?.gouCha;
  const latest = chain?.additions[chain.additions.length - 1];
  if (state.phase !== 'GOUCHA_QUERY' || chain === null || chain === undefined || latest === undefined
    || state.currentPlayer === input.humanPlayerId) return null;
  return { playerId: latest.playerId, addition: latest.addition, rank: chain.rank };
}

const CARD_BY_ID: ReadonlyMap<string, Card> = new Map(createDeck(2).map((card) => [card.id, card]));

function cardsOf(ids: readonly string[]): Card[] {
  return ids.flatMap((id) => {
    const card = CARD_BY_ID.get(id);
    return card === undefined ? [] : [card];
  });
}

function buildSeatAction(state: GameState, playerId: PlayerId): SeatActionViewModel | null {
  const trick = state.trick;
  if (trick === null) return null;
  for (let index = state.publicHistory.length - 1; index >= 0; index -= 1) {
    const record = state.publicHistory[index]!;
    if (record.actionNumber < trick.leadActionNumber) break;
    if (record.playerId !== playerId) continue;
    const key = record.actionNumber;
    if (record.kind === 'PASS') return { kind: 'PASS', cardIds: [], label: '不出', leading: false, key, bomb: false };
    if (record.kind === 'CHA' || record.kind === 'GOU') {
      return { kind: record.kind, cardIds: [...record.cardIds], label: record.kind === 'CHA' ? '岔' : '勾', leading: false, key, bomb: false };
    }
    const pattern = recognize(cardsOf(record.cardIds));
    return {
      key,
      bomb: pattern.kind === 'N_OF_KIND_BOMB' || pattern.kind === 'JOKER_BOMB' || pattern.kind === 'FOUR_A_FOUR',
      kind: 'PLAY',
      cardIds: [...record.cardIds],
      label: describePattern(pattern, state.phase),
      leading: record.actionNumber === trick.currentPlay.actionNumber && trick.gouCha === null,
    };
  }
  return null;
}

function buildCardCounter(state: GameState, ownHand: readonly Card[]): CardCounterEntry[] {
  const deckCount = state.deckCount ?? DEFAULT_DECK_COUNT;
  const unseen = new Map<Rank, number>();
  for (const card of createDeck(deckCount)) unseen.set(card.rank, (unseen.get(card.rank) ?? 0) + 1);
  for (const card of [...cardsOf(state.playedCardIds), ...ownHand]) unseen.set(card.rank, (unseen.get(card.rank) ?? 0) - 1);
  return [...unseen.entries()]
    .sort(([left], [right]) => right - left)
    .map(([rank, count]) => ({ rank, label: rankLabel(rank), unseen: Math.max(0, count) }));
}

function buildResult(state: GameState): ResultViewModel | null {
  if (state.result === null) return null;
  return buildResultViewModel(state.result, state.rootSeed ?? 0);
}

export function buildTableViewModel(state: GameState, input: HumanUiState): TableViewModel {
  if (!Number.isInteger(input.humanPlayerId) || input.humanPlayerId < 0 || input.humanPlayerId > 3) {
    throw new RangeError(`humanPlayerId must be an integer seat from 0 to 3; received ${String(input.humanPlayerId)}`);
  }
  const bottomId = input.humanPlayerId;
  const seated = seatPositions(bottomId, state.playerCount);
  const positions: Record<SeatPosition, PlayerId | null> = {
    bottom: bottomId,
    left: seated.left ?? null,
    top: seated.top ?? null,
    right: seated.right ?? null,
  };
  const seats = Object.fromEntries(Object.entries(positions).map(([position, playerId]) => {
    if (playerId === null) return [position, null];
    const player = state.players[playerId]!;
    const base = {
      playerId: player.playerId,
      teamId: player.teamId,
      remaining: player.hand.length,
      finishPlace: player.finishPlace,
      reportCount: player.lastReportedCount,
    };
    const view = player.playerId === bottomId
      ? { ...base, cards: player.hand.map((card) => ({ ...card })) }
      : base;
    return [position, view];
  })) as TableViewModel['seats'];

  const currentPlay = state.trick?.currentPlay ?? null;
  const inPlayPhase = state.phase === 'FREE_LEAD' || state.phase === 'RESPONDING';
  const humanTurn = state.currentPlayer === input.humanPlayerId;
  const controlsVisible = humanTurn && inPlayPhase;
  const selection = selectedPlayStatus(state, input);
  const gouCha = buildGouChaPrompt(state, input);
  const cardIds = tableCardIds(state);

  const seatActions = Object.fromEntries(Object.entries(positions)
    .map(([position, playerId]) => [position, playerId === null ? null : buildSeatAction(state, playerId)])) as unknown as TableViewModel['seatActions'];

  return {
    seats,
    playerCount: state.playerCount,
    seatActions,
    cardCounter: state.phase === 'SETUP' ? [] : buildCardCounter(state, state.players[bottomId]!.hand),
    center: {
      patternLabel: describePattern(currentPlay?.pattern ?? null, state.phase),
      holderId: state.trick?.holderId ?? null,
      cardIds: [...cardIds],
      contributions: buildContributions(state, cardIds),
      pending: buildPending(state, input),
    },
    controls: {
      showPlay: controlsVisible,
      showPass: controlsVisible && state.phase === 'RESPONDING',
      showHint: controlsVisible,
      playEnabled: controlsVisible && selection.enabled,
      errorKey: selection.errorKey,
    },
    gouCha,
    result: buildResult(state),
  };
}
