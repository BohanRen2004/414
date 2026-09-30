import { PlayPattern } from './play-pattern';

export function beats(candidate: PlayPattern, current: PlayPattern): boolean {
  if (candidate.kind === 'INVALID' || current.kind === 'INVALID') return false;

  if (candidate.kind === 'FOUR_A_FOUR') {
    return current.kind !== 'FOUR_A_FOUR' || (candidate.allHearts && !current.allHearts);
  }
  if (current.kind === 'FOUR_A_FOUR') return false;

  if (candidate.kind === 'JOKER_BOMB') return current.kind !== 'JOKER_BOMB';
  if (current.kind === 'JOKER_BOMB') return false;

  return compareOrdinaryAndBombs(candidate, current);
}

function compareOrdinaryAndBombs(candidate: PlayPattern, current: PlayPattern): boolean {
  if (candidate.kind === 'N_OF_KIND_BOMB') {
    if (current.kind === 'N_OF_KIND_BOMB') {
      return candidate.count > current.count
        || (candidate.count === current.count && candidate.rank > current.rank);
    }
    if (current.kind === 'SINGLE' || current.kind === 'PAIR') return candidate.count >= 3;
    if (
      current.kind === 'STRAIGHT'
      || current.kind === 'DOUBLE_STRAIGHT'
      || current.kind === 'TRIPLE_STRAIGHT'
    ) {
      return candidate.count >= current.multiplicity + 2;
    }
    return false;
  }

  if (current.kind === 'N_OF_KIND_BOMB' || candidate.kind !== current.kind) return false;
  if (candidate.kind === 'SINGLE' && current.kind === 'SINGLE') return candidate.rank > current.rank;
  if (candidate.kind === 'PAIR' && current.kind === 'PAIR') return candidate.rank > current.rank;
  if (
    (candidate.kind === 'STRAIGHT'
      || candidate.kind === 'DOUBLE_STRAIGHT'
      || candidate.kind === 'TRIPLE_STRAIGHT')
    && (current.kind === 'STRAIGHT'
      || current.kind === 'DOUBLE_STRAIGHT'
      || current.kind === 'TRIPLE_STRAIGHT')
  ) {
    return candidate.multiplicity === current.multiplicity
      && candidate.runLength === current.runLength
      && candidate.high > current.high;
  }
  return false;
}
