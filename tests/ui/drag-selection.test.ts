import { describe, expect, it } from 'vitest';
import { dragSelection } from '../../client/assets/scripts/ui/hand-selection';

describe('drag selection across the hand', () => {
  const hand = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('selects the dragged span in either direction and keeps the rest of the selection', () => {
    expect(dragSelection(['f'], hand, 1, 3)).toEqual(['b', 'c', 'd', 'f']);
    expect(dragSelection([], hand, 4, 2)).toEqual(['c', 'd', 'e']);
  });

  it('shrinks the span again when the drag comes back', () => {
    const wide = dragSelection([], hand, 0, 4);
    expect(wide).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(dragSelection([], hand, 0, 1)).toEqual(['a', 'b']);
  });

  it('clears the span when the drag starts on a selected card', () => {
    expect(dragSelection(['a', 'b', 'c', 'e'], hand, 1, 3)).toEqual(['a', 'e']);
  });

  it('keeps selected cards that are not draggable', () => {
    expect(dragSelection(['x'], hand, 0, 1)).toEqual(['x', 'a', 'b']);
    expect(dragSelection(['x'], hand, 9, 1)).toEqual(['x']);
  });
});
