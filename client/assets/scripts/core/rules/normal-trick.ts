import { Card, PlayerId } from '../cards/card';
import { beats } from '../patterns/compare';
import { recognize } from '../patterns/recognize';
import { GameAction } from '../state/game-action';
import { GameEvent } from '../state/game-event';
import { GameState, PlayerState, PublicActionRecord, TrickState } from '../state/game-state';
import type { ActionResult } from './reducer';
import { buildResult } from './results';

export function active(player: PlayerState): boolean {
  return player.hand.length > 0 && player.finishPlace === null;
}

export function nextActivePlayer(players: readonly PlayerState[], after: PlayerId): PlayerId | null {
  for (let offset = 1; offset <= 4; offset += 1) {
    const playerId = ((after + offset) % 4) as PlayerId;
    if (active(players[playerId]!)) return playerId;
  }
  return null;
}

export function recordFinish(state: GameState, playerId: PlayerId): GameState {
  if (state.finishOrder.includes(playerId)) return state;
  if (state.finishOrder.length >= 4) return state;
  const place = (state.finishOrder.length + 1) as 1 | 2 | 3 | 4;
  const [seat0, seat1, seat2, seat3] = state.players;
  const players: GameState['players'] = [
    playerId === 0 ? { ...seat0, finishPlace: place } : seat0,
    playerId === 1 ? { ...seat1, finishPlace: place } : seat1,
    playerId === 2 ? { ...seat2, finishPlace: place } : seat2,
    playerId === 3 ? { ...seat3, finishPlace: place } : seat3,
  ];
  return { ...state, players, finishOrder: [...state.finishOrder, playerId] };
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

/** The trick winner leads again; a finished winner hands the lead to their partner (借光), else clockwise. */
export function nextLeadPlayer(players: readonly PlayerState[], holderId: PlayerId): PlayerId | null {
  if (active(players[holderId]!)) return holderId;
  const partnerId = ((holderId + 2) % 4) as PlayerId;
  if (active(players[partnerId]!)) return partnerId;
  return nextActivePlayer(players, holderId);
}

function findNextResponder(
  players: readonly PlayerState[],
  holderId: PlayerId,
  passedPlayerIds: readonly PlayerId[],
  after: PlayerId,
): PlayerId | null {
  for (let offset = 1; offset <= 4; offset += 1) {
    const playerId = ((after + offset) % 4) as PlayerId;
    if (playerId !== holderId && active(players[playerId]!) && !passedPlayerIds.includes(playerId)) return playerId;
  }
  return null;
}

export function finishEvents(state: GameState, playerId: PlayerId, remaining: number): GameEvent[] {
  const events: GameEvent[] = [];
  const lastReportedCount = state.players[playerId]!.lastReportedCount;
  if (remaining > 0 && remaining <= 3 && remaining !== lastReportedCount) {
    events.push({ kind: 'PLAYER_REPORTED', playerId, remaining: remaining as 1 | 2 | 3 });
  }
  if (remaining === 0 && !state.finishOrder.includes(playerId)) {
    events.push({ kind: 'PLAYER_FINISHED', playerId, place: (state.finishOrder.length + 1) as 1 | 2 | 3 | 4 });
  }
  return events;
}

export function completeIfOneActive(state: GameState, events: GameEvent[]): GameState {
  const remaining = state.players.filter(active);
  if (remaining.length !== 1) return state;

  const lastPlayer = remaining[0]!;
  const finished = recordFinish(state, lastPlayer.playerId);
  events.push({
    kind: 'PLAYER_FINISHED',
    playerId: lastPlayer.playerId,
    place: (finished.finishOrder.length) as 1 | 2 | 3 | 4,
  });
  const result = buildResult(finished.finishOrder);
  events.push({ kind: 'ROUND_FINISHED' });
  return { ...finished, phase: 'ROUND_RESULT', currentPlayer: null, result };
}

export function playCards(state: GameState, action: Extract<GameAction, { kind: 'PLAY_CARDS' }>): ActionResult {
  if (state.phase !== 'FREE_LEAD' && state.phase !== 'RESPONDING') {
    return { ok: false, error: { code: 'WRONG_PHASE', messageKey: 'rule.wrong_phase', context: {} } };
  }
  if (state.currentPlayer !== action.playerId) {
    return { ok: false, error: { code: 'NOT_CURRENT_PLAYER', messageKey: 'rule.not_current_player', context: { playerId: action.playerId } } };
  }
  if (state.phase === 'RESPONDING' && state.trick === null) {
    return { ok: false, error: { code: 'WRONG_PHASE', messageKey: 'rule.wrong_phase', context: {} } };
  }
  if (new Set(action.cardIds).size !== action.cardIds.length) {
    return { ok: false, error: { code: 'DUPLICATE_CARD_ID', messageKey: 'rule.duplicate_card_id', context: {} } };
  }

  const player = state.players[action.playerId]!;
  const selected = action.cardIds.map((id) => player.hand.find((card) => card.id === id));
  if (selected.some((card) => card === undefined)) {
    return { ok: false, error: { code: 'CARD_NOT_OWNED', messageKey: 'rule.card_not_owned', context: { playerId: action.playerId } } };
  }
  const cards = selected as Card[];
  const pattern = recognize(cards);
  if (pattern.kind === 'INVALID') {
    return { ok: false, error: { code: 'INVALID_PATTERN', messageKey: 'rule.invalid_pattern', context: { reason: pattern.reason } } };
  }

  const previousTrick = state.trick;
  if (state.phase === 'RESPONDING' && previousTrick !== null && !beats(pattern, previousTrick.currentPlay.pattern)) {
    return { ok: false, error: { code: 'DOES_NOT_BEAT_CURRENT_PLAY', messageKey: 'rule.does_not_beat_current_play', context: {} } };
  }

  const remainingHand = player.hand.filter((card) => !action.cardIds.includes(card.id));
  const reportedCount = remainingHand.length > 0 && remainingHand.length <= 3
    ? remainingHand.length as 1 | 2 | 3
    : null;
  const [seat0, seat1, seat2, seat3] = state.players;
  const withUpdatedHand = (seat: PlayerState): PlayerState => seat.playerId === action.playerId
    ? { ...seat, hand: remainingHand, lastReportedCount: reportedCount }
    : seat;
  const updatedPlayers: GameState['players'] = [
    withUpdatedHand(seat0),
    withUpdatedHand(seat1),
    withUpdatedHand(seat2),
    withUpdatedHand(seat3),
  ];
  const actionData = appendAction(state, action.playerId, 'PLAY_CARDS', action.cardIds);
  let next: GameState = {
    ...state,
    ...actionData,
    phase: 'RESPONDING',
    players: updatedPlayers,
    currentPlayer: null,
    playedCardIds: [...state.playedCardIds, ...action.cardIds],
    trick: {
      currentPlay: {
        cardIds: [...action.cardIds],
        pattern,
        playerId: action.playerId,
        actionNumber: state.actionNumber,
      },
      holderId: action.playerId,
      nextResponder: null,
      passedPlayerIds: [],
      gouCha: null,
    },
  };

  const events: GameEvent[] = [{ kind: 'CARDS_PLAYED', playerId: action.playerId, cardIds: [...action.cardIds] }];
  events.push(...finishEvents(state, action.playerId, remainingHand.length));
  if (remainingHand.length === 0) next = recordFinish(next, action.playerId);
  next = completeIfOneActive(next, events);

  if (next.phase !== 'ROUND_RESULT') {
    const responder = nextActivePlayer(next.players, action.playerId);
    if (responder === null) {
      return { ok: false, error: { code: 'WRONG_PHASE', messageKey: 'rule.wrong_phase', context: {} } };
    }
    const trick: TrickState = { ...next.trick!, nextResponder: responder };
    next = { ...next, currentPlayer: responder, trick };
    events.push({ kind: 'TURN_CHANGED', playerId: responder });
  }

  return { ok: true, state: next, events };
}

export function passTurn(state: GameState, action: Extract<GameAction, { kind: 'PASS' }>): ActionResult {
  if (state.phase !== 'RESPONDING' || state.trick === null || state.trick.gouCha !== null) {
    return { ok: false, error: { code: 'WRONG_PHASE', messageKey: 'rule.wrong_phase', context: {} } };
  }
  if (state.currentPlayer !== action.playerId) {
    return { ok: false, error: { code: 'NOT_CURRENT_PLAYER', messageKey: 'rule.not_current_player', context: { playerId: action.playerId } } };
  }
  if (action.playerId === state.trick.holderId || !active(state.players[action.playerId]!)) {
    return { ok: false, error: { code: 'PASS_NOT_ALLOWED', messageKey: 'rule.pass_not_allowed', context: {} } };
  }

  const passedPlayerIds = state.trick.passedPlayerIds.includes(action.playerId)
    ? [...state.trick.passedPlayerIds]
    : [...state.trick.passedPlayerIds, action.playerId];
  const actionData = appendAction(state, action.playerId, 'PASS', []);
  const events: GameEvent[] = [{ kind: 'PLAYER_PASSED', playerId: action.playerId }];
  const allRespondersPassed = state.players.every((player) =>
    player.playerId === state.trick!.holderId || !active(player) || passedPlayerIds.includes(player.playerId),
  );

  if (allRespondersPassed) {
    const leadPlayer = nextLeadPlayer(state.players, state.trick.holderId);
    if (leadPlayer === null) {
      return { ok: false, error: { code: 'GAME_ALREADY_FINISHED', messageKey: 'rule.game_already_finished', context: {} } };
    }
    events.push({ kind: 'TRICK_RESET' }, { kind: 'TURN_CHANGED', playerId: leadPlayer });
    return {
      ok: true,
      state: {
        ...state,
        ...actionData,
        phase: 'FREE_LEAD',
        currentPlayer: leadPlayer,
        trick: null,
        publicHistory: [...state.publicHistory, { actionNumber: state.actionNumber, playerId: action.playerId, kind: 'PASS', cardIds: [] }],
      },
      events,
    };
  }

  const nextResponder = findNextResponder(state.players, state.trick.holderId, passedPlayerIds, action.playerId);
  if (nextResponder === null) {
    return { ok: false, error: { code: 'PASS_NOT_ALLOWED', messageKey: 'rule.pass_not_allowed', context: {} } };
  }
  const history = [...state.publicHistory, { actionNumber: state.actionNumber, playerId: action.playerId, kind: 'PASS' as const, cardIds: [] }];
  return {
    ok: true,
    state: {
      ...state,
      ...actionData,
      publicHistory: history,
      currentPlayer: nextResponder,
      trick: { ...state.trick, passedPlayerIds, nextResponder },
    },
    events: [...events, { kind: 'TURN_CHANGED', playerId: nextResponder }],
  };
}
