import { Card, PlayerId, Rank, TeamId } from '../core/cards/card';
import { CardGroup } from '../core/patterns/play-pattern';
import { XorShift32 } from '../core/random/prng';
import { GamePhase, GameResult, GameState, PublicActionRecord } from '../core/state/game-state';
import { canAddGouCha } from '../core/rules/goucha';

export interface AiPublicPlayer {
  readonly playerId: PlayerId;
  readonly teamId: TeamId;
  readonly remaining: number;
  readonly finishPlace: number | null;
}

export interface AiObservation {
  readonly playerId: PlayerId;
  readonly isCurrentPlayer: boolean;
  readonly teamId: TeamId;
  readonly ownHand: readonly Card[];
  readonly publicPlayers: readonly AiPublicPlayer[];
  readonly phase: GamePhase;
  readonly currentPlay: CardGroup | null;
  readonly publicPlayedCardIds: readonly string[];
  readonly publicHistory: readonly PublicActionRecord[];
  readonly result: GameResult | null;
  readonly decisionRandom: number;
  readonly legalContext: {
    readonly canPass: boolean;
    readonly gouChaNeed: 'CHA' | 'GOU' | null;
    readonly gouChaRank: Rank | null;
  };
}

/** Build a detached, information-safe view for one seat. */
export function buildObservation(state: GameState, playerId: PlayerId): AiObservation {
  if (!Number.isInteger(playerId) || playerId < 0 || playerId > 3) {
    throw new RangeError(`playerId must be an integer seat from 0 to 3; received ${String(playerId)}`);
  }
  const player = state.players[playerId]!;
  const currentPlayer = state.currentPlayer === playerId;
  const chain = state.trick?.gouCha ?? null;
  const canPass = currentPlayer
    && state.phase === 'RESPONDING'
    && state.trick !== null
    && state.trick.holderId !== playerId
    && player.hand.length > 0
    && player.finishPlace === null;
  const canAdd = currentPlayer && chain !== null && canAddGouCha(state, playerId);
  let decisionRandom = 0;
  if (state.randomState !== null) {
    const peek = new XorShift32(state.randomState.ai);
    decisionRandom = peek.nextUint32();
  }

  return {
    playerId,
    isCurrentPlayer: currentPlayer,
    teamId: player.teamId,
    ownHand: player.hand.map((card) => ({ ...card })),
    publicPlayers: state.players.map((seat) => ({
      playerId: seat.playerId,
      teamId: seat.teamId,
      remaining: seat.hand.length,
      finishPlace: seat.finishPlace,
    })),
    phase: state.phase,
    currentPlay: state.trick === null ? null : {
      cardIds: [...state.trick.currentPlay.cardIds],
      pattern: { ...state.trick.currentPlay.pattern },
      playerId: state.trick.currentPlay.playerId,
      actionNumber: state.trick.currentPlay.actionNumber,
    },
    publicPlayedCardIds: [...state.playedCardIds],
    publicHistory: state.publicHistory.map((record) => ({ ...record, cardIds: [...record.cardIds] })),
    result: state.result === null ? null : {
      ...state.result,
      finishOrder: [...state.result.finishOrder] as GameResult['finishOrder'],
    },
    decisionRandom,
    legalContext: {
      canPass,
      gouChaNeed: canAdd ? chain!.nextAddition : null,
      gouChaRank: canAdd ? chain!.rank : null,
    },
  };
}
