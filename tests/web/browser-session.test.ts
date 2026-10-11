import { describe, expect, it } from 'vitest';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { BrowserGameSession } from '../../web/src/browser-session';

function seedWithHumanLead(): number {
  for (let seed = 1; seed < 100; seed += 1) {
    if (dealFourPlayers(seed).firstPlayer === 0) return seed;
  }
  throw new Error('Expected a deterministic seed with seat 0 leading');
}

describe('browser game session', () => {
  it('starts the same seeded deal and AI sequence deterministically', async () => {
    const seed = 414;
    const left = new BrowserGameSession(seed, { animationDelayMs: 0 });
    const right = new BrowserGameSession(seed, { animationDelayMs: 0 });

    await Promise.all([left.start(), right.start()]);

    expect(left.state.rootSeed).toBe(seed);
    expect(left.state).toEqual(right.state);
    expect(left.state.phase).not.toBe('SETUP');
    expect(left.state.players[0].hand).toHaveLength(27);
  });

  it('uses generated legal hints and dispatches a human play through the controller', async () => {
    const session = new BrowserGameSession(seedWithHumanLead(), { animationDelayMs: 0 });
    await session.start();

    expect(session.state.currentPlayer).toBe(0);
    expect(session.state.phase).toBe('FREE_LEAD');
    session.cycleHint();
    expect(session.viewModel.controls.playEnabled).toBe(true);

    const dispatched = await session.playSelection();

    expect(dispatched).toBe(true);
    expect(session.state.publicHistory[0]?.playerId).toBe(0);
    expect(session.state.publicHistory[0]?.kind).toBe('PLAY_CARDS');
  });

  it('rejects Pass during a free lead without mutating the authoritative state', async () => {
    const session = new BrowserGameSession(seedWithHumanLead(), { animationDelayMs: 0 });
    await session.start();
    const before = session.state;

    const dispatched = await session.pass();

    expect(dispatched).toBe(false);
    expect(session.state).toBe(before);
  });
});
