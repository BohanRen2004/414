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

    /** Every rules state from `state` while AI seats act, ending at the human's turn or a result. */
    function aiStatesUntilHuman(state: GameState): GameState[] {
      const states = [state];
      let current = state;
      while (current.currentPlayer !== null && current.currentPlayer !== 0) {
        current = dispatch(current, chooseBasicAiAction(buildObservation(current, current.currentPlayer)));
        states.push(current);
      }
      return states;
    }

    function humanTurnAfter(state: GameState): GameState {
      const states = aiStatesUntilHuman(state);
      return states[states.length - 1]!;
    }

    function asked(states: readonly GameState[], playerId: 1 | 2 | 3, addition: 'CHA' | 'GOU'): boolean {
      return states.some((state) => state.phase === 'GOUCHA_QUERY' && state.currentPlayer === playerId
        && state.trick?.gouCha?.nextAddition === addition);
    }

    /** A screen showing a pending CHA/GOU: the chain on the table and no seat to act. */
    function isPendingScreen(shown: ReturnType<typeof screen>): boolean {
      return shown.phase === 'GOUCHA_QUERY' && shown.currentPlayer === null;
    }

    /** No screen may show an AI seat being asked; the human's own prompt is the only visible query. */
    function expectNoHiddenQueryShown(screens: readonly ReturnType<typeof screen>[]): void {
      for (const shown of screens) {
        if (shown.phase !== 'GOUCHA_QUERY') continue;
        expect([null, 0]).toContain(shown.currentPlayer);
        if (shown.currentPlayer === null) expect(shown.viewModel.gouCha).toBeNull();
      }
    }

    it('shows the same CHA, GOU and dead-chain reset whether or not other seats were asked and declined before them', async () => {
      const human = [c('h-nine', Rank.NINE, Suit.HEART), c('h-four', Rank.FOUR), c('h-jack', Rank.JACK)];
      const right = [c('r-nine-e', Rank.NINE), c('r-nine-f', Rank.NINE), c('r-eight', Rank.EIGHT), c('r-seven', Rank.SEVEN)];
      // Left holds a loose nine and is asked (and declines) to GOU its partner's CHA.
      const leftAskedToGou: Hands = {
        0: human,
        1: [c('l-nine-g', Rank.NINE, Suit.SPADE), c('l-ten', Rank.TEN), c('l-queen', Rank.QUEEN)],
        2: [c('p-nine-c', Rank.NINE, Suit.CLUB), c('p-three', Rank.THREE), c('p-king', Rank.KING)],
        3: right,
      };
      // The partner holds that nine instead, so it is asked (and declines) to CHA the human single.
      const partnerAskedToCha: Hands = {
        0: human,
        1: [c('p-king', Rank.KING), c('l-ten', Rank.TEN), c('l-queen', Rank.QUEEN)],
        2: [c('p-nine-c', Rank.NINE, Suit.CLUB), c('p-three', Rank.THREE), c('l-nine-g', Rank.NINE, Suit.SPADE)],
        3: right,
      };
      const leftWorld = aiStatesUntilHuman(queryAfter(leftAskedToGou, [0, 'h-nine']));
      const partnerWorld = aiStatesUntilHuman(queryAfter(partnerAskedToCha, [0, 'h-nine']));
      expect([asked(leftWorld, 1, 'GOU'), asked(leftWorld, 2, 'CHA')]).toEqual([true, false]);
      expect([asked(partnerWorld, 1, 'GOU'), asked(partnerWorld, 2, 'CHA')]).toEqual([false, true]);

      const leadNine = async (session: BrowserGameSession) => {
        session.toggleCard('h-nine');
        expect(await session.playSelection()).toBe(true);
      };
      const first = await playScreens(leftAskedToGou, leadNine);
      const second = await playScreens(partnerAskedToCha, leadNine);

      expect(first.screens).toEqual(second.screens);
      expect(first.maskedScreens).toBeGreaterThan(0);
      for (const run of [first, second]) {
        expect(run.session.state.publicHistory.map((record) => [record.actionNumber, record.playerId, record.kind, record.cardIds]))
          .toEqual([
            [1, 0, 'PLAY_CARDS', ['h-nine']],
            [2, 3, 'CHA', ['r-nine-e', 'r-nine-f']],
            [3, 2, 'GOU', ['p-nine-c']],
            // The dead chain ended the trick: the GOU player led again and nobody beat the chain.
            [4, 2, 'PLAY_CARDS', ['p-three']],
            [5, 3, 'PLAY_CARDS', ['r-seven']],
          ]);
        expect(run.session.state).toMatchObject({ phase: 'RESPONDING', currentPlayer: 0 });
      }
      expectNoHiddenQueryShown(first.screens);
      expect(first.screens.filter(isPendingScreen).map((shown) => shown.viewModel.center.pending)).toEqual([
        { playerId: 3, addition: 'CHA', rank: Rank.NINE },
        { playerId: 2, addition: 'GOU', rank: Rank.NINE },
      ]);
    });

    it('shows a neutral pending frame after every CHA and GOU, even when the chain closes at once', async () => {
      const human = [c('h-nine-a', Rank.NINE), c('h-nine-b', Rank.NINE), c('h-three', Rank.THREE)];
      const left = [c('l-six', Rank.SIX), c('l-jack', Rank.JACK), c('l-queen', Rank.QUEEN)];
      const right = [c('r-nine-e', Rank.NINE), c('r-nine-f', Rank.NINE), c('r-eight', Rank.EIGHT), c('r-seven', Rank.SEVEN)];
      // The partner holds a pair of nines: it is asked to CHA both the human single and the human GOU, and declines.
      const partnerAsked: Hands = {
        0: human,
        1: left,
        2: [c('p-nine-c', Rank.NINE), c('p-nine-d', Rank.NINE), c('p-ten', Rank.TEN), c('p-king', Rank.KING)],
        3: right,
      };
      // With one nine the partner is never asked, so the engine closes the chain the moment the human GOUs.
      const nobodyAsked: Hands = {
        0: human,
        1: left,
        2: [c('p-nine-c', Rank.NINE), c('p-five', Rank.FIVE), c('p-ten', Rank.TEN), c('p-king', Rank.KING)],
        3: right,
      };
      expect(queryAfter(partnerAsked, [0, 'h-nine-a'])).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
      expect(queryAfter(nobodyAsked, [0, 'h-nine-a'])).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 3 });
      const afterHumanGou = (hands: Hands) => dispatch(
        humanTurnAfter(queryAfter(hands, [0, 'h-nine-a'])),
        { kind: 'ADD_GOUCHA', playerId: 0, addition: 'GOU', cardIds: ['h-nine-b'] },
      );
      expect(afterHumanGou(partnerAsked)).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 2 });
      expect(afterHumanGou(nobodyAsked)).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 0, trick: null });

      const leadThenGou = async (session: BrowserGameSession) => {
        session.toggleCard('h-nine-a');
        expect(await session.playSelection()).toBe(true);
        expect(session.viewModel.gouCha).toMatchObject({ playerId: 0, addition: 'GOU', rank: Rank.NINE, requiredCount: 1 });
        session.toggleCard('h-nine-b');
        expect(await session.submitGouCha()).toBe(true);
      };
      const asked = await playScreens(partnerAsked, leadThenGou);
      const closedAtOnce = await playScreens(nobodyAsked, leadThenGou);

      expect(asked.screens).toEqual(closedAtOnce.screens);
      expectNoHiddenQueryShown(closedAtOnce.screens);
      for (const run of [asked, closedAtOnce]) {
        expect(run.session.state).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 0, trick: null });
        expect(run.session.state.publicHistory.map((record) => [record.playerId, record.kind]))
          .toEqual([[0, 'PLAY_CARDS'], [3, 'CHA'], [0, 'GOU']]);
      }

      const screens = closedAtOnce.screens;
      const pendingIndexes = screens.flatMap((shown, index) => isPendingScreen(shown) ? [index] : []);
      expect(pendingIndexes).toHaveLength(2);
      const [afterCha, afterGou] = pendingIndexes.map((index) => screens[index]!);
      expect(afterCha!.viewModel.center).toMatchObject({
        patternLabel: '单 9',
        holderId: 3,
        cardIds: ['h-nine-a', 'r-nine-e', 'r-nine-f'],
        pending: { playerId: 3, addition: 'CHA', rank: Rank.NINE },
      });
      expect(afterCha!.viewModel.center.contributions.map((part) => [part.playerId, part.label])).toEqual([[0, '出牌'], [3, '岔']]);
      expect(afterCha!.events.map((event) => event.kind)).toEqual(['GOUCHA_ADDED', 'PLAYER_REPORTED']);
      expect(afterGou!.viewModel.center).toMatchObject({
        patternLabel: '单 9',
        holderId: 0,
        cardIds: ['h-nine-a', 'r-nine-e', 'r-nine-f', 'h-nine-b'],
        pending: { playerId: 0, addition: 'GOU', rank: Rank.NINE },
      });
      expect(afterGou!.viewModel.controls).toMatchObject({ showPlay: false, showPass: false });
      // The CHA frame is followed by the human's GOU prompt, the GOU frame by the reset and the human's new lead.
      expect(screens[pendingIndexes[0]! + 1]).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 0 });
      expect(screens[pendingIndexes[1]! + 1]).toMatchObject({
        phase: 'FREE_LEAD',
        currentPlayer: 0,
        trick: null,
        events: [{ kind: 'TRICK_RESET' }, { kind: 'TURN_CHANGED', playerId: 0 }],
      });
      for (const shown of screens) {
        expect(shown.viewModel.center.patternLabel).not.toMatch(/轰|炸弹/);
      }
    });

    it('shows a pending frame after the human declines a GOU, whether or not another seat is asked next', async () => {
      const human = [c('h-nine-a', Rank.NINE), c('h-nine-b', Rank.NINE), c('h-three', Rank.THREE)];
      const partner = [c('p-ten', Rank.TEN), c('p-king', Rank.KING), c('p-six', Rank.SIX)];
      const right = [c('r-nine-e', Rank.NINE), c('r-nine-f', Rank.NINE), c('r-eight', Rank.EIGHT), c('r-seven', Rank.SEVEN)];
      const leftAsked: Hands = { 0: human, 1: [c('l-nine-g', Rank.NINE), c('l-jack', Rank.JACK), c('l-queen', Rank.QUEEN)], 2: partner, 3: right };
      const nobodyAsked: Hands = { 0: human, 1: [c('l-five', Rank.FIVE), c('l-jack', Rank.JACK), c('l-queen', Rank.QUEEN)], 2: partner, 3: right };
      const afterHumanDecline = (hands: Hands) => dispatch(
        humanTurnAfter(queryAfter(hands, [0, 'h-nine-a'])),
        { kind: 'DECLINE_GOUCHA', playerId: 0 },
      );
      expect(afterHumanDecline(leftAsked)).toMatchObject({ phase: 'GOUCHA_QUERY', currentPlayer: 1 });
      expect(afterHumanDecline(nobodyAsked)).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 3, trick: null });

      const leadThenDecline = async (session: BrowserGameSession) => {
        session.toggleCard('h-nine-a');
        expect(await session.playSelection()).toBe(true);
        expect(session.viewModel.gouCha).toMatchObject({ playerId: 0, addition: 'GOU' });
        expect(await session.declineGouCha()).toBe(true);
      };
      const asked = await playScreens(leftAsked, leadThenDecline);
      const closedAtOnce = await playScreens(nobodyAsked, leadThenDecline);

      expect(asked.screens).toEqual(closedAtOnce.screens);
      expectNoHiddenQueryShown(asked.screens);
      const screens = asked.screens;
      const declineFrame = screens.findIndex((shown) => isPendingScreen(shown)
        && shown.events.some((event) => event.kind === 'GOUCHA_DECLINED'));
      expect(declineFrame).toBeGreaterThan(0);
      expect(screens[declineFrame]!.viewModel.center.pending).toEqual({ playerId: 3, addition: 'CHA', rank: Rank.NINE });
      expect(screens[declineFrame + 1]).toMatchObject({ phase: 'FREE_LEAD', currentPlayer: 3, trick: null });
      for (const run of [asked, closedAtOnce]) {
        // The dead CHA ended the trick, so the CHA player led a fresh trick and the human now responds to it.
        expect(run.session.state.publicHistory.map((record) => [record.playerId, record.kind, record.cardIds]))
          .toEqual([[0, 'PLAY_CARDS', ['h-nine-a']], [3, 'CHA', ['r-nine-e', 'r-nine-f']], [3, 'PLAY_CARDS', ['r-seven']]]);
        expect(run.session.state).toMatchObject({ phase: 'RESPONDING', currentPlayer: 0 });
      }
    });
  });
});
