import { Card, Rank, Suit } from '../core/cards/card';
import { beats } from '../core/patterns/compare';
import { recognize } from '../core/patterns/recognize';
import { GameAction } from '../core/state/game-action';
import { AiObservation } from './ai-observation';

function cardOrder(left: Card, right: Card): number {
  return left.deckIndex - right.deckIndex || left.suit - right.suit || left.id.localeCompare(right.id);
}

function choose(cards: readonly Card[], count: number, preserveHearts: boolean): Card[] | null {
  if (cards.length < count) return null;
  const ordered = [...cards].sort((a, b) => {
    if (a.rank !== Rank.FOUR && a.rank !== Rank.ACE) return cardOrder(a, b);
    const aHeart = a.suit === Suit.HEART;
    const bHeart = b.suit === Suit.HEART;
    if (aHeart !== bHeart) return preserveHearts ? Number(aHeart) - Number(bHeart) : Number(bHeart) - Number(aHeart);
    return cardOrder(a, b);
  });
  return ordered.slice(0, count);
}

function addStructuralPlays(hand: readonly Card[], result: GameAction[], observation: AiObservation): void {
  const byRank = new Map<Rank, Card[]>();
  for (const card of hand) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  const push = (cards: readonly Card[]): void => {
    const pattern = recognize(cards);
    if (pattern.kind === 'INVALID') return;
    if (observation.phase === 'RESPONDING'
      && (observation.currentPlay === null || !beats(pattern, observation.currentPlay.pattern))) return;
    result.push({ kind: 'PLAY_CARDS', playerId: observation.playerId, cardIds: cards.map((card) => card.id) });
  };

  for (const [rank, cards] of byRank) {
    push(choose(cards, 1, true)!);
    if (cards.length >= 2) push(choose(cards, 2, true)!);
    if (rank <= Rank.TWO) {
      for (let count = 3; count <= Math.min(8, cards.length); count += 1) push(choose(cards, count, true)!);
    }
  }

  const small = choose(byRank.get(Rank.SMALL_JOKER) ?? [], 1, true);
  const big = choose(byRank.get(Rank.BIG_JOKER) ?? [], 1, true);
  if (small !== null && big !== null) push([...small, ...big]);

  for (let multiplicity = 1; multiplicity <= 3; multiplicity += 1) {
    for (let low = Rank.THREE; low <= Rank.ACE; low += 1) {
      for (let high = low + 2; high <= Rank.ACE; high += 1) {
        const sequence: Card[] = [];
        let possible = true;
        for (let rank = low; rank <= high; rank += 1) {
          const selected = choose(byRank.get(rank) ?? [], multiplicity, true);
          if (selected === null) { possible = false; break; }
          sequence.push(...selected);
        }
        if (possible) push(sequence);
      }
    }
  }

  const fours = byRank.get(Rank.FOUR) ?? [];
  const aces = byRank.get(Rank.ACE) ?? [];
  const fourSelection = choose(fours, 2, true);
  const aceSelection = choose(aces, 1, true);
  if (fourSelection !== null && aceSelection !== null) push([...fourSelection, ...aceSelection]);

  const spendingFour = choose(fours, 2, false);
  const spendingAce = choose(aces, 1, false);
  if (spendingFour !== null && spendingAce !== null) push([...spendingFour, ...spendingAce]);
}

/** Enumerate representative legal actions from rank structure, never all hand subsets. */
export function generateCandidates(observation: AiObservation): readonly GameAction[] {
  const actions: GameAction[] = [];
  if (observation.phase === 'GOUCHA_QUERY') {
    if (!observation.isCurrentPlayer) return actions;
    if (observation.legalContext.gouChaNeed !== null && observation.legalContext.gouChaRank !== null) {
      const matching = observation.ownHand.filter((card) => card.rank === observation.legalContext.gouChaRank);
      const required = observation.legalContext.gouChaNeed === 'CHA' ? 2 : 1;
      const selected = choose(matching, required, true);
      if (selected !== null) actions.push({
        kind: 'ADD_GOUCHA',
        playerId: observation.playerId,
        addition: observation.legalContext.gouChaNeed,
        cardIds: selected.map((card) => card.id),
      });
    }
    actions.push({ kind: 'DECLINE_GOUCHA', playerId: observation.playerId });
    return actions;
  }

  if (observation.phase !== 'FREE_LEAD' && observation.phase !== 'RESPONDING') return actions;
  if (!observation.isCurrentPlayer) return actions;
  addStructuralPlays(observation.ownHand, actions, observation);
  if (observation.phase === 'RESPONDING' && observation.legalContext.canPass) {
    actions.push({ kind: 'PASS', playerId: observation.playerId });
  }

  const unique = new Map<string, GameAction>();
  for (const action of actions) unique.set(`${action.kind}:${'cardIds' in action ? [...action.cardIds].sort().join(',') : ''}`, action);
  return [...unique.values()];
}
