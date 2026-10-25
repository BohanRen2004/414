import { Card, PlayerId } from '../cards/card';
import { CardGroup } from '../patterns/play-pattern';
import { GameAction } from '../state/game-action';
import { GameEvent } from '../state/game-event';
import { GameState, GouChaChain, PlayerState, PublicActionRecord, TrickState } from '../state/game-state';
import { RuleError, ruleError } from '../state/rule-error';
import { active, completeIfOneActive, finishEvents, nextActivePlayer, nextLeadPlayer, recordFinish } from './normal-trick';
import type { ActionResult } from './reducer';

function requiredCount(addition: 'CHA' | 'GOU'): 2 | 1 {
  return addition === 'CHA' ? 2 : 1;
}

export function requiredGouChaCount(kind: 'CHA' | 'GOU'): 2 | 1 {
  return requiredCount(kind);
}

function countRank(hand: readonly Card[], rank: Card['rank']): number {
  return hand.reduce((count, card) => count + Number(card.rank === rank), 0);
}

function eligible(state: GameState, chain: GouChaChain, playerId: PlayerId): boolean {
  const player = state.players[playerId]!;
  return playerId !== chain.holderId
    && active(player)
    && !chain.declinedPlayerIds.includes(playerId)
    && countRank(player.hand, chain.rank) >= requiredCount(chain.nextAddition);
}

export function canAddGouCha(state: GameState, playerId: PlayerId): boolean {
  const chain = state.trick?.gouCha;
  return state.phase === 'GOUCHA_QUERY'
    && chain !== null
    && chain !== undefined
    && state.currentPlayer === playerId
    && eligible(state, chain, playerId);
}

/** Every card the chain has put on the table, in contribution order. For display only: it is never compared. */
export function gouChaCardIds(chain: GouChaChain): string[] {
  return [...chain.basePlay.cardIds, ...chain.additions.flatMap((addition) => addition.cardIds)];
}

/**
 * Stop asking. A single nobody CHA'd never became a chain, so ordinary responding to it continues.
 * Once a CHA has happened the chain is dead (死岔/死勾): nobody may beat or answer it, the trick ends at once,
 * and the last contributor leads next, lending the lead exactly as an ordinary trick winner would (借光).
 */
function closeChain(state: GameState, chain: GouChaChain): GameState {
  if (chain.additions.length > 0) {
    return { ...state, phase: 'FREE_LEAD', currentPlayer: nextLeadPlayer(state.players, chain.holderId), trick: null };
  }
  const nextResponder = nextActivePlayer(state.players, chain.holderId);
  return {
    ...state,
    phase: 'RESPONDING',
    currentPlayer: nextResponder,
    trick: {
      ...state.trick!,
      currentPlay: chain.basePlay,
      holderId: chain.holderId,
      nextResponder,
      passedPlayerIds: [],
      gouCha: null,
    },
  };
}

/** Select the next eligible player; after a complete scan, close the chain (see closeChain). */
export function advanceGouChaQuery(state: GameState): GameState {
  const chain = state.trick?.gouCha;
  if (chain === null || chain === undefined) return state;

  for (let offset = 1; offset <= 4; offset += 1) {
    const playerId = ((chain.queryCursor + offset) % 4) as PlayerId;
    if (!eligible(state, chain, playerId)) continue;
    const nextChain = { ...chain, queryCursor: playerId };
    const trick: TrickState = { ...state.trick!, gouCha: nextChain, nextResponder: playerId };
    return { ...state, phase: 'GOUCHA_QUERY', currentPlayer: playerId, trick };
  }

  return closeChain(state, chain);
}

/** Begin a chain only when a successful single has at least one possible CHA response. */
export function maybeStartGouCha(state: GameState, base: CardGroup): GameState {
  const pattern = base.pattern;
  if (pattern.kind !== 'SINGLE' || state.phase !== 'RESPONDING' || state.trick === null) return state;
  const holderId = base.playerId;
  if (!state.players.some((player) =>
    player.playerId !== holderId && active(player) && countRank(player.hand, pattern.rank) >= 2,
  )) return state;

  const chain: GouChaChain = {
    rank: pattern.rank,
    basePlay: base,
    additions: [],
    holderId,
    nextAddition: 'CHA',
    queryCursor: holderId,
    declinedPlayerIds: [],
  };
  const trick: TrickState = { ...state.trick, gouCha: chain };
  return advanceGouChaQuery({ ...state, phase: 'GOUCHA_QUERY', currentPlayer: null, trick });
}

function appendAction(
  state: GameState,
  playerId: PlayerId,
  kind: PublicActionRecord['kind'],
  cardIds: readonly string[],
): Pick<GameState, 'publicHistory' | 'actionNumber'> {
  return {
    publicHistory: [
      ...state.publicHistory,
      { actionNumber: state.actionNumber, playerId, kind, cardIds: [...cardIds] },
    ],
    actionNumber: state.actionNumber + 1,
  };
}

/** A query moved on, a chain without CHA reopened ordinary response, or a dead chain reset the trick. */
function transitionEvents(state: GameState): GameEvent[] {
  if (state.phase === 'ROUND_RESULT' || state.currentPlayer === null) return [];
  const turn: GameEvent = { kind: 'TURN_CHANGED', playerId: state.currentPlayer };
  return state.phase === 'FREE_LEAD' ? [{ kind: 'TRICK_RESET' }, turn] : [turn];
}

function error(code: RuleError['code'], context: RuleError['context'] = {}): ActionResult {
  return { ok: false, error: ruleError(code, context) };
}

export function addGouCha(
  state: GameState,
  action: Extract<GameAction, { kind: 'ADD_GOUCHA' }>,
): ActionResult {
  const chain = state.trick?.gouCha;
  if (state.phase !== 'GOUCHA_QUERY' || chain === null || chain === undefined) {
    return error('WRONG_PHASE');
  }
  if (action.playerId === chain.holderId) return error('SELF_GOUCHA_FORBIDDEN');
  if (state.currentPlayer !== action.playerId) {
    return error('NOT_CURRENT_PLAYER', { playerId: action.playerId });
  }
  if (action.addition !== chain.nextAddition) return error('WRONG_GOUCHA_STEP');
  if (new Set(action.cardIds).size !== action.cardIds.length) return error('DUPLICATE_CARD_ID');
  if (action.cardIds.length !== requiredCount(action.addition)) {
    return error('GOUCHA_COUNT_MISMATCH', { expected: requiredCount(action.addition), actual: action.cardIds.length });
  }

  const player = state.players[action.playerId]!;
  const selected = action.cardIds.map((id) => player.hand.find((card) => card.id === id));
  if (selected.some((card) => card === undefined)) return error('CARD_NOT_OWNED', { playerId: action.playerId });
  const cards = selected as Card[];
  if (cards.some((card) => card.rank !== chain.rank)) {
    return error('GOUCHA_RANK_MISMATCH', { expected: chain.rank });
  }
  if (!active(player)) return error('NOT_CURRENT_PLAYER', { playerId: action.playerId });

  const remainingHand = player.hand.filter((card) => !action.cardIds.includes(card.id));
  const remaining = remainingHand.length;
  const updatePlayer = (seat: PlayerState): PlayerState => seat.playerId === action.playerId
    ? { ...seat, hand: remainingHand, lastReportedCount: remaining > 0 && remaining <= 3 ? remaining as 1 | 2 | 3 : null }
    : seat;
  const [seat0, seat1, seat2, seat3] = state.players;
  const updatedPlayers: GameState['players'] = [
    updatePlayer(seat0),
    updatePlayer(seat1),
    updatePlayer(seat2),
    updatePlayer(seat3),
  ];
  const actionData = appendAction(state, action.playerId, action.addition, action.cardIds);
  const addition = {
    addition: action.addition,
    playerId: action.playerId,
    cardIds: [...action.cardIds],
    actionNumber: state.actionNumber,
  } as const;
  const nextAddition = action.addition === 'CHA' ? 'GOU' : 'CHA';
  const nextChain: GouChaChain = {
    ...chain,
    additions: [...chain.additions, addition],
    holderId: action.playerId,
    nextAddition,
    queryCursor: action.playerId,
    declinedPlayerIds: [],
  };
  const baseState: GameState = {
    ...state,
    ...actionData,
    phase: 'GOUCHA_QUERY',
    players: updatedPlayers,
    currentPlayer: null,
    playedCardIds: [...state.playedCardIds, ...action.cardIds],
    // The current play stays the base single: CHA/GOU cards join the chain, not a merged pattern.
    trick: {
      ...state.trick!,
      holderId: action.playerId,
      passedPlayerIds: [],
      gouCha: nextChain,
    },
  };

  const events: GameEvent[] = [
    { kind: 'GOUCHA_ADDED', playerId: action.playerId, addition: action.addition, cardIds: [...action.cardIds] },
    ...finishEvents(state, action.playerId, remaining),
  ];
  let next = remaining === 0 ? recordFinish(baseState, action.playerId) : baseState;
  next = completeIfOneActive(next, events);
  if (next.phase !== 'ROUND_RESULT') {
    next = advanceGouChaQuery(next);
    events.push(...transitionEvents(next));
  }
  return { ok: true, state: next, events };
}

/**
 * A decline is private: who was asked and who declined is never public, so it adds no history
 * record and takes no action number (a gap in the numbering would reveal it).
 */
export function declineGouCha(state: GameState, playerId: PlayerId): ActionResult {
  const chain = state.trick?.gouCha;
  if (state.phase !== 'GOUCHA_QUERY' || chain === null || chain === undefined) return error('WRONG_PHASE');
  if (playerId === chain.holderId) return error('SELF_GOUCHA_FORBIDDEN');
  if (state.currentPlayer !== playerId) return error('NOT_CURRENT_PLAYER', { playerId });

  const declinedChain = {
    ...chain,
    declinedPlayerIds: [...chain.declinedPlayerIds, playerId],
  };
  const declined: GameState = {
    ...state,
    currentPlayer: null,
    trick: { ...state.trick!, gouCha: declinedChain },
  };
  const next = advanceGouChaQuery(declined);
  return {
    ok: true,
    state: next,
    events: [
      { kind: 'GOUCHA_DECLINED', playerId },
      ...transitionEvents(next),
    ],
  };
}
