import { describe, expect, it } from 'vitest';
import { buildResult } from '../../client/assets/scripts/core/rules/results';

describe('round result', () => {
  it.each([
    [[0, 2, 1, 3], 0, 2],
    [[0, 1, 2, 3], 0, 1],
    [[0, 1, 3, 2], 0, 0],
    [[1, 3, 0, 2], 1, 1],
    [[1, 0, 3, 2], 1, 1],
    [[1, 0, 2, 3], 1, 0],
  ] as const)('calculates finish order %j', (order, winningTeam, capturedOpponents) => {
    expect(buildResult(order)).toEqual({
      finishOrder: order,
      winningTeam,
      capturedOpponents,
    });
  });

  it('rejects incomplete or duplicate finish orders', () => {
    expect(() => buildResult([0, 1, 2])).toThrow(/four unique players/);
    expect(() => buildResult([0, 1, 1, 3])).toThrow(/four unique players/);
  });
});
