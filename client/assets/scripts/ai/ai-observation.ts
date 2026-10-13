import { Card, PlayerId, Rank, TeamId } from '../core/cards/card';
import { CardGroup } from '../core/patterns/play-pattern';
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
  /** The play to beat; during a gou-cha chain it stays the chain's single, the CHA/GOU cards are not a pattern. */
  readonly currentPlay: CardGroup | null;
  /** Latest public contributor to the trick: the current play's owner, or during a chain the last CHA/GOU player. */
  readonly holderId: PlayerId | null;
  readonly publicPlayedCardIds: readonly string[];
  readonly publicHistory: readonly PublicActionRecord[];
  readonly result: GameResult | null;
  /** Tie-break value hashed from this seat's public view only, so it cannot reveal the deal. */
  readonly decisionRandom: number;
  readonly legalContext: {
    readonly canPass: boolean;
    readonly gouChaNeed: 'CHA' | 'GOU' | null;
    readonly gouChaRank: Rank | null;
  };
}

/** FNV-1a with a murmur3 finalizer; any well-mixed hash works because the input is already public. */
function hashPublicView(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Canonical order, so the shuffled deal order of the hand never reaches the AI. */
function compareCards(left: Card, right: Card): number {
  return left.rank - right.rank || left.suit - right.suit || left.deckIndex - right.deckIndex;
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
  const publicView = state.publicHistory.map((record) => [
    record.actionNumber,
    record.playerId,
    record.kind,
    [...record.cardIds].sort(),
  ]);
  const decisionRandom = hashPublicView(JSON.stringify([playerId, state.actionNumber, publicView]));

  return {
    playerId,
    isCurrentPlayer: currentPlayer,
    teamId: player.teamId,
    ownHand: [...player.hand].sort(compareCards).map((card) => ({ ...card })),
    publicPlayers: state.players.map((seat) => ({
      playerId: seat.playerId,
      teamId: seat.teamId,
      remaining: seat.hand.length,
      finishPlace: seat.finishPlace,
    })),
    phase: state.phase,
    holderId: state.trick?.holderId ?? null,
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
