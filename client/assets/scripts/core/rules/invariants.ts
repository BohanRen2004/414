import { PlayerId } from '../cards/card';
import { GameState } from '../state/game-state';
import { gouChaCardIds } from './goucha';
import { buildResult } from './results';

export type InvariantCode =
  | 'CARD_DUPLICATED'
  | 'CARD_TOTAL'
  | 'FINISH_DUPLICATED'
  | 'CURRENT_PLAYER_INVALID'
  | 'PHASE_TRICK_MISMATCH';

const playerIds = new Set<number>([0, 1, 2, 3]);

function fail(code: InvariantCode, details: string): never {
  throw new Error(`${code}: ${details}`);
}

function assertCardConservation(state: GameState): void {
  if (state.phase === 'SETUP') {
    const setupIsEmpty = state.players.every((player) => player.hand.length === 0)
      && state.playedCardIds.length === 0;
    if (!setupIsEmpty) fail('CARD_TOTAL', 'SETUP must not contain dealt cards');
    return;
  }

  const cardIds = [
    ...state.players.flatMap((player) => player.hand.map((card) => card.id)),
    ...state.playedCardIds,
  ];
  const seen = new Set<string>();
  for (const id of cardIds) {
    if (seen.has(id)) fail('CARD_DUPLICATED', `physical card ID ${id} appears more than once`);
    seen.add(id);
  }
  if (cardIds.length !== 108) {
    fail('CARD_TOTAL', `expected 108 cards across hands and played area, found ${cardIds.length}`);
  }
}

function assertFinishOrder(state: GameState): void {
  if (new Set(state.finishOrder).size !== state.finishOrder.length) {
    fail('FINISH_DUPLICATED', 'finish order contains a player more than once');
  }

  const seenPlaces = new Set<number>();
  for (const player of state.players) {
    if (player.finishPlace === null) continue;
    if (seenPlaces.has(player.finishPlace)) fail('FINISH_DUPLICATED', `finish place ${player.finishPlace} is assigned more than once`);
    seenPlaces.add(player.finishPlace);
  }

  if (state.finishOrder.length !== seenPlaces.size || state.finishOrder.some((id, index) => {
    const player = state.players[id];
    return !playerIds.has(id) || player?.finishPlace !== index + 1;
  })) {
    fail('FINISH_DUPLICATED', 'finish order and player finish places do not agree');
  }

  for (const player of state.players) {
    if ((player.finishPlace !== null && player.finishPlace < 4 && player.hand.length > 0)
      || (player.finishPlace === 4 && state.phase !== 'ROUND_RESULT')
      || (state.phase === 'ROUND_RESULT' && player.finishPlace === null)
      || ((state.phase === 'FREE_LEAD' || state.phase === 'RESPONDING' || state.phase === 'GOUCHA_QUERY')
        && player.hand.length === 0 && player.finishPlace === null)) {
      fail('FINISH_DUPLICATED', `player ${player.playerId} finish place conflicts with hand size or phase`);
    }
  }
}

function assertCurrentPlayer(state: GameState): void {
  const id = state.currentPlayer;
  if (id !== null) {
    if (!playerIds.has(id) || state.players[id as PlayerId] === undefined) {
      fail('CURRENT_PLAYER_INVALID', `current player ${String(id)} is outside seats 0..3`);
    }
    const player = state.players[id as PlayerId];
    if (player.hand.length === 0 || player.finishPlace !== null) {
      fail('CURRENT_PLAYER_INVALID', `current player ${id} is not active`);
    }
  }

  if ((state.phase === 'SETUP' || state.phase === 'ROUND_RESULT') && id !== null) {
    fail('CURRENT_PLAYER_INVALID', `${state.phase} cannot have a current player`);
  }
  if ((state.phase === 'FREE_LEAD' || state.phase === 'RESPONDING' || state.phase === 'GOUCHA_QUERY') && id === null) {
    fail('CURRENT_PLAYER_INVALID', `${state.phase} requires a current player`);
  }
}

function assertPhaseAndTrick(state: GameState): void {
  const trick = state.trick;
  if (state.phase === 'SETUP' || state.phase === 'FREE_LEAD' || state.phase === 'TRICK_RESET') {
    if (trick !== null) fail('PHASE_TRICK_MISMATCH', `${state.phase} must not retain a trick`);
    return;
  }
  if (state.phase === 'RESPONDING') {
    if (trick === null || trick.gouCha !== null || trick.holderId !== trick.currentPlay.playerId
      || trick.nextResponder !== state.currentPlayer
      || new Set(trick.currentPlay.cardIds).size !== trick.currentPlay.cardIds.length
      || trick.currentPlay.cardIds.some((id) => !state.playedCardIds.includes(id))) {
      fail('PHASE_TRICK_MISMATCH', 'RESPONDING requires a matching ordinary trick');
    }
    return;
  }
  if (state.phase === 'GOUCHA_QUERY') {
    const chain = trick?.gouCha;
    if (trick === null || chain === null || chain === undefined || trick.holderId !== chain.holderId) {
      fail('PHASE_TRICK_MISMATCH', 'GOUCHA_QUERY requires a matching active chain');
    }
    const base = chain.basePlay;
    // holders[i] held the chain when addition i was made; nobody may add to their own cards.
    const holders = [base.playerId, ...chain.additions.map((addition) => addition.playerId)];
    const invalidAddition = chain.additions.length > 4 || chain.additions.some((addition, index) =>
      addition.addition !== (index % 2 === 0 ? 'CHA' : 'GOU')
      || addition.cardIds.length !== (addition.addition === 'CHA' ? 2 : 1)
      || addition.playerId === holders[index]);
    const chainIds = gouChaCardIds(chain);
    if (base.pattern.kind !== 'SINGLE'
      || base.pattern.rank !== chain.rank
      || invalidAddition
      || chain.holderId !== holders[holders.length - 1]
      || new Set(chainIds).size !== chainIds.length
      || chainIds.some((id) => !state.playedCardIds.includes(id))
      || chain.nextAddition !== (chain.additions.length % 2 === 0 ? 'CHA' : 'GOU')
      || state.currentPlayer === chain.holderId
      || chain.queryCursor !== state.currentPlayer
      || trick.nextResponder !== state.currentPlayer) {
      fail('PHASE_TRICK_MISMATCH', 'gou-cha chain does not match its additions, holder, or query');
    }
    // CHA and GOU are actions, not a pattern: the current play stays exactly the base single.
    const play = trick.currentPlay;
    if (play.pattern.kind !== 'SINGLE'
      || play.pattern.rank !== chain.rank
      || play.playerId !== base.playerId
      || play.actionNumber !== base.actionNumber
      || play.cardIds.length !== base.cardIds.length
      || play.cardIds.some((id, index) => id !== base.cardIds[index])) {
      fail('PHASE_TRICK_MISMATCH', 'trick current play must remain the gou-cha base single');
    }
    return;
  }
  if (state.phase === 'ROUND_RESULT') {
    if (trick === null || state.result === null || state.finishOrder.length !== 4) {
      fail('PHASE_TRICK_MISMATCH', 'ROUND_RESULT requires a result and complete finish order');
    }
    const expectedResult = buildResult(state.finishOrder);
    if (state.result.winningTeam !== expectedResult.winningTeam
      || state.result.capturedOpponents !== expectedResult.capturedOpponents
      || state.result.finishOrder.some((playerId, index) => playerId !== expectedResult.finishOrder[index])) {
      fail('PHASE_TRICK_MISMATCH', 'ROUND_RESULT does not match the recorded finish order');
    }
    return;
  }
  if (state.phase === 'DEALING' || state.phase === 'FATAL_ERROR') return;
}

export function assertGameState(state: GameState): void {
  assertCardConservation(state);
  assertFinishOrder(state);
  assertCurrentPlayer(state);
  assertPhaseAndTrick(state);
}
