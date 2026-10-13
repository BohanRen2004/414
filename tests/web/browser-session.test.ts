import { describe, expect, it } from 'vitest';
import { buildObservation } from '../../client/assets/scripts/ai/ai-observation';
import { chooseBasicAiAction } from '../../client/assets/scripts/ai/basic-ai';
import { Card, Rank, Suit } from '../../client/assets/scripts/core/cards/card';
import { dealFourPlayers } from '../../client/assets/scripts/core/cards/deck';
import { GameState } from '../../client/assets/scripts/core/state/game-state';
import { BrowserGameSession, BrowserSessionSnapshot } from '../../web/src/browser-session';
import { c } from '../helpers/cards';
import { dispatch } from '../helpers/actions';
import { buildState } from '../helpers/state-builder';

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

  describe('hidden gou-cha queries', () => {
    type Hands = Parameters<typeof buildState>[0]['hands'];

    /** Everything the page draws from a snapshot: view model, phase banner inputs, seat highlight, center and history. */
    function screen(snapshot: BrowserSessionSnapshot) {
      const { state } = snapshot;
      return {
        viewModel: snapshot.viewModel,
        phase: state.phase,
        currentPlayer: state.currentPlayer,
        nextAddition: state.trick?.gouCha?.nextAddition ?? null,
        trick: state.trick === null ? null : { currentPlay: state.trick.currentPlay, holderId: state.trick.holderId },
        history: state.publicHistory,
        actionNumber: state.actionNumber,
        selectedCardIds: snapshot.selectedCardIds,
        events: snapshot.events,
        isBusy: snapshot.isBusy,
        errorCode: snapshot.errorCode,
      };
    }

    /**
     * Record every published screen while the human acts. Re-rendering (help, notices) must show the
     * same screen, and input attempted while AI turns run must change nothing.
     */
    async function playScreens(hands: Hands, act: (session: BrowserGameSession) => Promise<void>) {
      const initialState = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands });
      const session = new BrowserGameSession(414, { animationDelayMs: 0, initialState });
      const screens: ReturnType<typeof screen>[] = [];
      // The session swallows listener errors, so failures are collected and asserted afterwards.
      const listenerErrors: unknown[] = [];
      let maskedScreens = 0;
      let probing = false;
      session.subscribe((snapshot) => {
        screens.push(screen(snapshot));
        if (probing) return;
        try {
          expect(session.snapshot().state).toEqual(snapshot.state);
          expect(session.viewModel).toEqual(snapshot.viewModel);
          if (snapshot.state !== session.state) {
            maskedScreens += 1;
            expect(snapshot.isBusy).toBe(true);
          }
          if (!snapshot.isBusy) return;
          probing = true;
          const published = screens.length;
          const selected = session.selectedCardIds;
          const firstCard = session.state.players[0].hand[0];
          if (firstCard !== undefined) session.toggleCard(firstCard.id);
          session.clearSelection();
          session.cycleHint();
          expect(session.selectedCardIds).toEqual(selected);
          expect(screens).toHaveLength(published);
          void session.pass().then((done) => expect(done).toBe(false)).catch((error) => listenerErrors.push(error));
          void session.playSelection().then((done) => expect(done).toBe(false)).catch((error) => listenerErrors.push(error));
          void session.submitGouCha().then((done) => expect(done).toBe(false)).catch((error) => listenerErrors.push(error));
          void session.declineGouCha().then((done) => expect(done).toBe(false)).catch((error) => listenerErrors.push(error));
        } catch (error) {
          listenerErrors.push(error);
        } finally {
          probing = false;
        }
      });
      await act(session);
      expect(listenerErrors).toEqual([]);
      return { session, screens, maskedScreens };
    }

    function queryAfter(hands: Hands, ...plays: readonly (readonly [0 | 1 | 2 | 3, string])[]): GameState {
      let state = buildState({ phase: 'FREE_LEAD', currentPlayer: 0, hands });
      for (const [playerId, cardId] of plays) state = dispatch(state, { kind: 'PLAY_CARDS', playerId, cardIds: [cardId] });
      return state;
    }

    it('shows the same screens whether or not the partner was asked to CHA the human single and declined', async () => {
      const human = [c('h-two', Rank.TWO), c('h-three', Rank.THREE), c('h-four', Rank.FOUR)];
      const left = [c('l-five', Rank.FIVE), c('l-seven', Rank.SEVEN), c('l-nine', Rank.NINE), c('l-jack', Rank.JACK)];
      const asked: Hands = {
        0: human,
        1: left,
        2: [c('p-two-b', Rank.TWO), c('p-two-c', Rank.TWO), c('p-eight', Rank.EIGHT), c('p-ten', Rank.TEN)],
        3: [c('r-six', Rank.SIX), c('r-queen', Rank.QUEEN), c('r-king', Rank.KING), c('r-nine', Rank.NINE)],
      };
      const notAsked: Hands = {
        0: human,
        1: left,
        2: [c('p-two-b', Rank.TWO), c('r-six', Rank.SIX), c('p-eight', Rank.EIGHT), c('p-ten', Rank.TEN)],
        3: [c('p-two-c', Rank.TWO), c('r-queen', Rank.QUEEN), c('r-king', Rank.KING), c('r-nine', Rank.NINE)],
      };
      const query = queryAfter(asked, [0, 'h-two']);
      expect(query).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
      expect(chooseBasicAiAction(buildObservation(query, 2))).toEqual({ kind: 'DECLINE_GOUCHA', playerId: 2 });
      expect(queryAfter(notAsked, [0, 'h-two']).phase).toBe('RESPONDING');

      const leadTwo = async (session: BrowserGameSession) => {
        session.toggleCard('h-two');
        expect(await session.playSelection()).toBe(true);
      };
      const withQuery = await playScreens(asked, leadTwo);
      const withoutQuery = await playScreens(notAsked, leadTwo);

      expect(withQuery.screens).toEqual(withoutQuery.screens);
      expect(withQuery.session.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 0 });
      expect(withQuery.session.state.publicHistory.map((record) => [record.actionNumber, record.playerId, record.kind]))
        .toEqual([[1, 0, 'PLAY_CARDS'], [2, 1, 'PASS'], [3, 2, 'PASS'], [4, 3, 'PASS']]);
    });

    it('opens the human prompt straight after the AI single even when a hidden seat was asked first', async () => {
      const human = [c('h-three', Rank.THREE), c('h-five-a', Rank.FIVE), c('h-five-b', Rank.FIVE), c('h-king', Rank.KING)];
      const left = [c('l-five', Rank.FIVE), c('l-nine-a', Rank.NINE), c('l-nine-b', Rank.NINE), c('l-jack', Rank.JACK)];
      const asked: Hands = {
        0: human,
        1: left,
        2: [c('z-four', Rank.FOUR), c('p-six', Rank.SIX), c('p-ten', Rank.TEN), c('p-queen', Rank.QUEEN)],
        3: [c('r-five-c', Rank.FIVE), c('r-five-d', Rank.FIVE), c('r-eight', Rank.EIGHT), c('r-king', Rank.KING)],
      };
      const notAsked: Hands = {
        0: human,
        1: left,
        2: [c('r-five-d', Rank.FIVE), c('p-six', Rank.SIX), c('p-ten', Rank.TEN), c('p-queen', Rank.QUEEN)],
        3: [c('r-five-c', Rank.FIVE), c('z-four', Rank.FOUR), c('r-eight', Rank.EIGHT), c('r-king', Rank.KING)],
      };
      const query = queryAfter(asked, [0, 'h-three'], [1, 'l-five']);
      expect(query).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 3 });
      expect(chooseBasicAiAction(buildObservation(query, 3))).toEqual({ kind: 'DECLINE_GOUCHA', playerId: 3 });
      expect(queryAfter(notAsked, [0, 'h-three'], [1, 'l-five'])).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 0 });

      const leadThenDecline = async (session: BrowserGameSession) => {
        session.toggleCard('h-three');
        expect(await session.playSelection()).toBe(true);
        expect(session.viewModel.gouCha).toMatchObject({ playerId: 0, addition: 'CHA', rank: Rank.FIVE });
        expect(await session.declineGouCha()).toBe(true);
      };
      const withQuery = await playScreens(asked, leadThenDecline);
      const withoutQuery = await playScreens(notAsked, leadThenDecline);

      expect(withQuery.screens).toEqual(withoutQuery.screens);
      expect(withQuery.session.state).toMatchObject({ phase: 'RESPONDING', currentPlayer: 0 });
      expect(withQuery.session.state.publicHistory.map((record) => [record.playerId, record.cardIds]))
        .toEqual([[0, ['h-three']], [1, ['l-five']], [2, ['p-six']], [3, ['r-eight']]]);
    });

    it('shows the same CHA and GOU whether or not other seats were asked and declined before them', async () => {
      const human = [c('h-nine', Rank.NINE, Suit.HEART), c('h-three', Rank.THREE), c('h-four', Rank.FOUR)];
      const right = [c('r-nine-c', Rank.NINE), c('r-nine-d', Rank.NINE), c('r-eight', Rank.EIGHT), c('r-seven', Rank.SEVEN)];
      const nineA: Card = c('p-nine-a', Rank.NINE, Suit.CLUB);
      const nineB: Card = c('p-nine-b', Rank.NINE, Suit.SPADE);
      const partnerAsked: Hands = {
        0: human,
        1: [c('z-six', Rank.SIX), c('l-jack', Rank.JACK), c('l-queen', Rank.QUEEN)],
        2: [nineA, nineB, c('p-ten', Rank.TEN), c('p-king', Rank.KING)],
        3: right,
      };
      const leftAskedLater: Hands = {
        0: human,
        1: [nineB, c('l-jack', Rank.JACK), c('l-queen', Rank.QUEEN)],
        2: [nineA, c('z-six', Rank.SIX), c('p-ten', Rank.TEN), c('p-king', Rank.KING)],
        3: right,
      };
      expect(queryAfter(partnerAsked, [0, 'h-nine'])).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
      expect(queryAfter(leftAskedLater, [0, 'h-nine'])).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 3 });

      const leadNine = async (session: BrowserGameSession) => {
        session.toggleCard('h-nine');
        expect(await session.playSelection()).toBe(true);
      };
      const first = await playScreens(partnerAsked, leadNine);
      const second = await playScreens(leftAskedLater, leadNine);

      expect(first.screens).toEqual(second.screens);
      expect(first.maskedScreens).toBeGreaterThan(0);
      expect(first.session.state.publicHistory.map((record) => [record.actionNumber, record.playerId, record.kind, record.cardIds]))
        .toEqual([
          [1, 0, 'PLAY_CARDS', ['h-nine']],
          [2, 3, 'CHA', ['r-nine-c', 'r-nine-d']],
          [3, 2, 'GOU', ['p-nine-a']],
          [4, 3, 'PASS', []],
        ]);
      expect(first.screens.some((shown) => shown.phase === 'GOUCHA_QUERY')).toBe(false);
    });
  });
});
