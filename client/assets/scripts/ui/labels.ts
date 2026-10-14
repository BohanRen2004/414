import { Card, PlayerId, Rank, Suit } from '../core/cards/card';
import { GameState } from '../core/state/game-state';
import { TableViewModel } from './table-view-model';

/** Display labels shared by every front end (browser page, WeChat mini game). */

export const SUIT_GLYPH: Readonly<Record<Suit, string>> = {
  [Suit.CLUB]: '♣',
  [Suit.DIAMOND]: '♦',
  [Suit.HEART]: '♥',
  [Suit.SPADE]: '♠',
  [Suit.JOKER]: '✦',
};

const RANK_LABEL: Readonly<Record<Rank, string>> = {
  [Rank.THREE]: '3',
  [Rank.FOUR]: '4',
  [Rank.FIVE]: '5',
  [Rank.SIX]: '6',
  [Rank.SEVEN]: '7',
  [Rank.EIGHT]: '8',
  [Rank.NINE]: '9',
  [Rank.TEN]: '10',
  [Rank.JACK]: 'J',
  [Rank.QUEEN]: 'Q',
  [Rank.KING]: 'K',
  [Rank.ACE]: 'A',
  [Rank.TWO]: '2',
  [Rank.SMALL_JOKER]: '小王',
  [Rank.BIG_JOKER]: '大王',
};

export function rankLabel(rank: Rank): string {
  return RANK_LABEL[rank];
}

/** Hearts, diamonds and the big joker print in red. */
export function isRedCard(card: Card): boolean {
  return card.suit === Suit.HEART || card.suit === Suit.DIAMOND || card.rank === Rank.BIG_JOKER;
}

/** Seat names as seen from the human's seat 0. */
export function playerName(playerId: PlayerId | number): string {
  if (playerId === 0) return '你';
  if (playerId === 2) return '搭档';
  return playerId === 1 ? '左对家' : '右对家';
}

/** Hand display order: by rank, then suit, then which deck the card came from. */
export function sortCardsForDisplay(cards: readonly Card[]): Card[] {
  return [...cards].sort((left, right) => left.rank - right.rank || left.suit - right.suit || left.deckIndex - right.deckIndex);
}

export function formatSeed(seed: number): string {
  return `#${seed.toString().padStart(10, '0')}`;
}

export const HISTORY_ACTION_LABEL = { PLAY_CARDS: '出牌', PASS: '不出', CHA: '岔', GOU: '勾' } as const;

/** The status line under the table for the human (seat 0 offline, their own seat online). */
export function phaseMessage(
  state: GameState,
  viewModel: TableViewModel,
  isBusy: boolean,
  name: (playerId: PlayerId) => string = playerName,
  viewerId: PlayerId = 0,
): string {
  if (state.phase === 'ROUND_RESULT') return '本局结束';
  // A CHA/GOU just happened. Nobody is highlighted: whether anyone is being asked to continue is private.
  const pending = viewModel.center.pending;
  if (pending !== null) {
    return `${name(pending.playerId)}${pending.addition === 'CHA' ? '岔' : '勾'} ${rankLabel(pending.rank)}，看有没有人接`;
  }
  if (state.phase === 'GOUCHA_QUERY' && state.currentPlayer === viewerId) {
    const addition = state.trick?.gouCha?.nextAddition;
    return addition === 'CHA' ? '轮到你岔：选同点数的一对牌' : '轮到你勾：选同点数的一张牌';
  }
  // While earlier moves are still being shown, the human's turn is not open yet (it may still be pre-empted by a 岔).
  if (state.currentPlayer === viewerId && isBusy && (state.phase === 'FREE_LEAD' || state.phase === 'RESPONDING')) return '等待其他玩家…';
  if (state.currentPlayer === viewerId && state.phase === 'FREE_LEAD') return '轮到你自由出牌';
  if (state.currentPlayer === viewerId && state.phase === 'RESPONDING') return '轮到你压牌，或选择不出';
  return state.currentPlayer === null ? '正在准备牌局' : `${name(state.currentPlayer)}思考中`;
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
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
  // Rules core reasons, as the online server reports them.
  'NOT_CURRENT_PLAYER': '现在还没有轮到你。',
  'WRONG_PHASE': '当前阶段不能执行这个动作。',
  'DOES_NOT_BEAT_CURRENT_PLAY': '这组牌压不过桌面牌。',
  'PASS_NOT_ALLOWED': '现在不能不出。',
  'CARD_NOT_OWNED': '选择的牌已不在你的手牌中。',
  'INVALID_PATTERN': '这组牌不符合已确认的牌型。',
  // Room errors.
  'NETWORK': '网络不太好，请再试一次。',
  'ROOM_NOT_FOUND': '房间不存在或已经关闭。',
  'ROOM_FULL': '房间已满。',
  'GAME_IN_PROGRESS': '这局还在进行，结束后再来。',
  'NOT_IN_ROOM': '你已不在这个房间。',
  'NOT_HOST': '只有房主可以这样做。',
  'SEAT_TAKEN': '这个座位已经有人了。',
  'WRONG_STATUS': '现在不能这样做。',
  'BUSY': '服务器忙，请再试一次。',
  'BAD_REQUEST': '请求无效。',
};

/** Human-readable text for a selection or rule error key; empty when there is no error. */
export function errorMessage(code: string | null): string {
  if (code === null) return '';
  return ERROR_MESSAGES[code] ?? `操作未生效（${code}）`;
}
