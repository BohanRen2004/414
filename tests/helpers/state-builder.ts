import { Card, PlayerId, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { createDoubleDeck, dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { CardGroup } from '../../client/assets/scripts/core/patterns/play-pattern';
import { GamePhase, GameState, GouChaChain, PlayerState, TrickState } from '../../client/assets/scripts/core/state/game-state';
import { hasFlexibleFixtureSuit } from './cards';

export interface StateFixture {
  readonly seed?: number;
  readonly phase: GamePhase;
  readonly currentPlayer: PlayerId | null;
  readonly hands: Readonly<Record<PlayerId, readonly Card[]>>;
  readonly currentPlay?: CardGroup;
  readonly holderId?: PlayerId;
  readonly passedPlayerIds?: readonly PlayerId[];
  readonly finishOrder?: readonly PlayerId[];
  readonly gouCha?: GouChaChain;
  /** Applied last for deliberate invariant-corruption fixtures. */
  readonly overrides?: Partial<GameState>;
}

function getPatternRanks(pattern: CardGroup['pattern']): Rank[] {
  switch (pattern.kind) {
    case 'SINGLE':
    case 'PAIR':
      return Array.from({ length: pattern.kind === 'SINGLE' ? 1 : 2 }, () => pattern.rank);
    case 'N_OF_KIND_BOMB':
      return Array.from({ length: pattern.count }, () => pattern.rank);
    case 'JOKER_BOMB':
      return [Rank.SMALL_JOKER, Rank.BIG_JOKER];
    case 'FOUR_A_FOUR':
      return [Rank.FOUR, Rank.FOUR, Rank.ACE];
    case 'STRAIGHT':
    case 'DOUBLE_STRAIGHT':
    case 'TRIPLE_STRAIGHT': {
      const ranks: Rank[] = [];
      for (let rank = pattern.low; rank <= pattern.high; rank += 1) {
        for (let copy = 0; copy < pattern.multiplicity; copy += 1) ranks.push(rank);
      }
      return ranks;
    }
    default:
      return [];
  }
}

function requiredSuit(group: CardGroup, rank: Rank): Suit | null {
  if (rank === Rank.SMALL_JOKER || rank === Rank.BIG_JOKER) return Suit.JOKER;
  if (group.pattern.kind === 'FOUR_A_FOUR' && group.pattern.allHearts) return Suit.HEART;
  return null;
}

function takeCanonical(
  alias: string,
  rank: Rank,
  suit: Suit | null,
  unused: Card[],
  canonicalDeck: readonly Card[],
): Card {
  const namedCanonical = canonicalDeck.find((card) => card.id === alias);
  if (namedCanonical && (namedCanonical.rank !== rank || (suit !== null && namedCanonical.suit !== suit))) {
    throw new Error(`Fixture alias ${alias} conflicts with its canonical card identity`);
  }

  const index = unused.findIndex((card) =>
    card.rank === rank && (suit === null || card.suit === suit) &&
    (namedCanonical === undefined || card.id === namedCanonical.id),
  );
  if (index < 0) throw new Error(`Fixture exceeds physical card supply for rank ${rank}`);
  return unused.splice(index, 1)[0]!;
}

function aliasGroup(
  group: CardGroup,
  unused: Card[],
  canonicalDeck: readonly Card[],
  tableIds: Map<string, Card>,
  allowedExistingIds: ReadonlySet<string> = new Set(),
): void {
  const ids = [...new Set(group.cardIds)];
  const ranks = getPatternRanks(group.pattern);
  if (ids.length !== group.cardIds.length || ids.length !== ranks.length) {
    throw new Error('Fixture card group IDs do not match its recognized pattern');
  }

  ids.forEach((id, index) => {
    const rank = ranks[index]!;
    const suit = requiredSuit(group, rank);
    const prior = tableIds.get(id);
    if (prior) {
      if (!allowedExistingIds.has(id)) throw new Error(`Fixture card ID ${id} is reused outside the current-play aggregate`);
      if (prior.rank !== rank || (suit !== null && prior.suit !== suit)) {
        throw new Error(`Fixture card ID ${id} conflicts with its prior rank or suit`);
      }
      return;
    }
    const canonical = takeCanonical(id, rank, suit, unused, canonicalDeck);
    tableIds.set(id, { ...canonical, id });
  });

  if (group.pattern.kind === 'FOUR_A_FOUR') {
    const allHearts = ids.every((id) => tableIds.get(id)!.suit === Suit.HEART);
    if (allHearts !== group.pattern.allHearts) {
      throw new Error('Fixture 4A4 card suits conflict with its all-hearts classification');
    }
  }
}

function playerState(playerId: PlayerId, hand: readonly Card[], finishOrder: readonly PlayerId[]): PlayerState {
  const finishPlace = finishOrder.indexOf(playerId);
  const remaining = hand.length;
  return {
    playerId,
    teamId: (playerId % 2) as 0 | 1,
    controlType: playerId === 0 ? 'HUMAN' : 'BASIC_AI',
    hand,
    finishPlace: finishPlace < 0 ? null : (finishPlace + 1) as 1 | 2 | 3 | 4,
    lastReportedCount: remaining >= 1 && remaining <= 3 ? remaining as 1 | 2 | 3 : null,
  };
}

export function buildState(fixture: StateFixture): GameState {
  const canonicalDeck = createDoubleDeck();
  const unused = [...canonicalDeck];
  const hands = new Map<PlayerId, readonly Card[]>();
  const seenIds = new Set<string>();
  const finishOrder = fixture.finishOrder ?? [];
  for (const [placeIndex, playerId] of finishOrder.slice(0, 3).entries()) {
    if (fixture.hands[playerId].length > 0) {
      throw new Error(`Fixture finish place ${placeIndex + 1} (player ${playerId}) must have an empty hand`);
    }
  }
  const fourthPlayer = finishOrder[3];
  if (fourthPlayer !== undefined && fixture.hands[fourthPlayer].length > 0 && fixture.phase !== 'ROUND_RESULT') {
    throw new Error(`Fixture fourth-place player ${fourthPlayer} may retain cards only in ROUND_RESULT`);
  }

  for (const playerId of [0, 1, 2, 3] as const) {
    const aliasedHand = fixture.hands[playerId].map((card) => {
      if (seenIds.has(card.id)) throw new Error(`Fixture card ID ${card.id} is used more than once`);
      seenIds.add(card.id);
      const canonical = takeCanonical(
        card.id,
        card.rank,
        hasFlexibleFixtureSuit(card) ? null : card.suit,
        unused,
        canonicalDeck,
      );
      return { ...canonical, id: card.id };
    });
    hands.set(playerId, aliasedHand);
  }

  const tableIds = new Map<string, Card>();
  if (fixture.gouCha) {
    aliasGroup(fixture.gouCha.basePlay, unused, canonicalDeck, tableIds);
  }
  if (fixture.gouCha) {
    for (const addition of fixture.gouCha.additions) {
      const expectedCount = addition.addition === 'CHA' ? 2 : 1;
      if (addition.cardIds.length !== expectedCount) throw new Error('Fixture gou-cha addition has the wrong card count');
      if (new Set(addition.cardIds).size !== addition.cardIds.length) {
        throw new Error('Fixture gou-cha addition repeats a card ID');
      }
      for (const id of addition.cardIds) {
        if (tableIds.has(id)) throw new Error(`Fixture gou-cha addition reuses table card ID ${id}`);
        if (seenIds.has(id)) throw new Error(`Fixture card ID ${id} is used in both a hand and the table`);
        const canonical = takeCanonical(id, fixture.gouCha.rank, null, unused, canonicalDeck);
        tableIds.set(id, { ...canonical, id });
      }
    }
  }
  if (fixture.currentPlay) {
    aliasGroup(
      fixture.currentPlay,
      unused,
      canonicalDeck,
      tableIds,
      fixture.gouCha ? new Set(tableIds.keys()) : new Set(),
    );
  }

  for (const id of tableIds.keys()) {
    if (seenIds.has(id)) throw new Error(`Fixture card ID ${id} is used in both a hand and the table`);
    seenIds.add(id);
  }

  const players: GameState['players'] = [
    playerState(0, hands.get(0)!, finishOrder),
    playerState(1, hands.get(1)!, finishOrder),
    playerState(2, hands.get(2)!, finishOrder),
    playerState(3, hands.get(3)!, finishOrder),
  ];
  const hasTrick = fixture.currentPlay !== undefined || fixture.gouCha !== undefined;
  let trick: TrickState | null = null;
  if (hasTrick) {
    const currentPlay = fixture.currentPlay ?? {
      cardIds: fixture.gouCha!.aggregateCardIds,
      pattern: fixture.gouCha!.aggregatePattern,
      playerId: fixture.gouCha!.holderId,
      actionNumber: 1,
    };
    trick = {
      currentPlay,
      holderId: fixture.holderId ?? fixture.gouCha?.holderId ?? currentPlay.playerId,
      nextResponder: fixture.currentPlayer,
      passedPlayerIds: fixture.passedPlayerIds ?? [],
      gouCha: fixture.gouCha ?? null,
    };
  }

  const seed = fixture.seed ?? (fixture.phase === 'SETUP' ? null : 414);
  const setupDeal = seed === null ? null : dealFourPlayers(seed);
  const playedCardIds = [...tableIds.keys(), ...unused.map((card) => card.id)];
  const allStateCardIds = [...players.flatMap((player) => player.hand.map((card) => card.id)), ...playedCardIds];
  if (allStateCardIds.length !== canonicalDeck.length || new Set(allStateCardIds).size !== canonicalDeck.length) {
    throw new Error('Fixture card IDs do not form a unique complete physical deck');
  }
  const state: GameState = {
    rulesVersion: '1.1.0',
    phase: fixture.phase,
    rootSeed: seed,
    randomState: setupDeal === null ? null : { deal: setupDeal.dealStateAfterSetup },
    firstPlayer: fixture.phase === 'SETUP' ? null : 0,
    players,
    currentPlayer: fixture.currentPlayer,
    trick,
    finishOrder,
    playedCardIds,
    publicHistory: [],
    actionNumber: fixture.phase === 'SETUP' ? 0 : 1,
    result: null,
  };
  return { ...state, ...fixture.overrides };
}
