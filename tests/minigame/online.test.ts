import { describe, expect, it } from 'vitest';
import { RoomRequest, RoomResponse } from '../../client/assets/scripts/online/protocol';
import { MiniGameApp, OnlineHost, Platform } from '../../minigame/src/app';
import { RoomTransport } from '../../minigame/src/online-session';
import { Canvas2D, HitRegion, Rect } from '../../minigame/src/render';
import { replayGame } from '../../server/room/engine';
import { handleRoomRequest } from '../../server/room/handler';
import { MemoryRoomStore } from '../../server/room/memory-store';

function fakeCanvas(): Canvas2D & { readonly numbers: number[]; readonly texts: string[] } {
  const numbers: number[] = [];
  const texts: string[] = [];
  const record = (...values: number[]) => { numbers.push(...values); };
  return {
    numbers,
    texts,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '12px sans-serif', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
    fillRect: record, moveTo: record, lineTo: record, arcTo: record, arc: record,
    fillText(value: string, x: number, y: number) { texts.push(value); record(x, y); },
    measureText(value: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12);
      return { width: [...value].length * size * 0.6 };
    },
  };
}

/** A cloud with one in-memory store; each player gets a transport that calls the handler as themselves. */
class FakeCloud {
  public readonly store = new MemoryRoomStore();
  public time = 1_700_000_000_000;
  private seed = 0x2468_ace1;
  public calls = 0;

  public transport(openid: string): RoomTransport {
    return {
      call: async (request: RoomRequest): Promise<RoomResponse> => {
        this.calls += 1;
        const response = await handleRoomRequest(this.store, {
          openid,
          now: () => this.time,
          randomUint32: () => {
            let x = this.seed;
            x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
            this.seed = x >>> 0;
            return this.seed;
          },
        }, JSON.parse(JSON.stringify(request)));
        return JSON.parse(JSON.stringify(response)) as RoomResponse;
      },
      // Pokes run on a later tick, like a realtime push.
      watch: (onPoke) => this.store.watch(openid, () => { setTimeout(onPoke, 0); }),
    };
  }
}

interface Player {
  readonly app: MiniGameApp;
  readonly canvas: ReturnType<typeof fakeCanvas>;
  readonly shared: { title: string; query: string }[];
  readonly storage: Map<string, string>;
}

function player(cloud: FakeCloud, openid: string, answers: (string | null)[]): Player {
  const canvas = fakeCanvas();
  const shared: { title: string; query: string }[] = [];
  const storage = new Map<string, string>();
  const online: OnlineHost = {
    transport: () => cloud.transport(openid),
    prompt: async () => (answers.length > 0 ? answers.shift()! : null),
    share: (title, query) => { shared.push({ title, query }); },
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { if (value === null) storage.delete(key); else storage.set(key, value); },
  };
  const platform: Platform = {
    context: canvas,
    viewport: { width: 844, height: 390, insetLeft: 44, insetRight: 44, insetTop: 0, insetBottom: 21 },
    random: () => 0.5,
    // Timers never fire on their own: polling and countdowns stay quiet, the test drives syncs.
    setTimeout: () => 0,
    clearTimeout: () => {},
    now: () => cloud.time,
    online,
  };
  const app = new MiniGameApp(platform, { animationDelayMs: 0 });
  app.render();
  return { app, canvas, shared, storage };
}

function center(rect: Rect): [number, number] {
  return [rect.x + rect.w / 2, rect.y + rect.h / 2];
}

async function tapAction(app: MiniGameApp, action: string): Promise<boolean> {
  const region = app.tappable.find((candidate) => 'action' in candidate && candidate.action === action);
  if (region === undefined) return false;
  await app.tap(...center(region.rect));
  return true;
}

function hasAction(app: MiniGameApp, action: string): boolean {
  return app.tappable.some((region) => 'action' in region && region.action === action);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('online play in the mini game', () => {
  it('creates a room, invites a friend who joins by code, and both play a full game by tapping', async () => {
    const cloud = new FakeCloud();
    const host = player(cloud, 'host-openid', ['阿明']);
    const friend = player(cloud, 'friend-openid', ['小红']);

    expect(hasAction(host.app, 'create-room')).toBe(true);
    await tapAction(host.app, 'deck-1');
    await tapAction(host.app, 'create-room');
    const room = host.app.room!;
    expect(room).not.toBeNull();
    expect(room.view.status).toBe('lobby');
    expect(room.view.deckCount).toBe(1);
    expect(host.storage.get('414.nickname')).toBe('阿明');
    expect(host.canvas.texts.some((text) => text.includes(`房间 ${room.view.code}`))).toBe(true);

    await tapAction(host.app, 'invite');
    expect(host.shared[0]!.query).toBe(`room=${room.view.code}`);

    // The friend opens the share card.
    await friend.app.joinRoom(room.view.code);
    expect(friend.app.room!.view.mySeat).toBe(1);
    // The friend moves across to be the host's partner.
    await tapAction(friend.app, 'seat-2');
    expect(friend.app.room!.view.mySeat).toBe(2);
    await settle();
    expect(host.app.room!.view.seats[2].name).toBe('小红');
    expect(hasAction(friend.app, 'start-online')).toBe(false);

    await tapAction(host.app, 'start-online');
    await settle();
    await friend.app.room!.sync();
    await settle();
    expect(host.app.room!.view.status).toBe('playing');

    const roomId = room.view.roomId;
    for (let turn = 0; turn < 1500; turn += 1) {
      const truth = replayGame(cloud.store.rooms.get(roomId)!.game!).state;
      if (truth.phase === 'ROUND_RESULT') break;
      const actor = truth.currentPlayer === 0 ? host : friend;
      await actor.app.room!.sync();
      await settle();
      if (await tapAction(actor.app, 'decline-goucha')) continue;
      await tapAction(actor.app, 'hint');
      if (await tapAction(actor.app, 'play')) continue;
      if (await tapAction(actor.app, 'pass')) continue;
      throw new Error(`seat ${truth.currentPlayer} has nothing to tap in ${truth.phase}`);
    }
    for (const someone of [host, friend]) {
      await someone.app.room!.sync();
      await settle();
      expect(someone.app.room!.state.phase).toBe('ROUND_RESULT');
      expect(someone.canvas.texts.some((text) => text.includes('拿下这局'))).toBe(true);
      expect(someone.canvas.numbers.every(Number.isFinite)).toBe(true);
    }
    expect(hasAction(host.app, 'room-lobby')).toBe(true);
    expect(hasAction(friend.app, 'room-lobby')).toBe(false);

    // Back to the room for another game; the friend hears about it.
    await tapAction(host.app, 'room-lobby');
    await settle();
    expect(host.app.room!.view.status).toBe('lobby');
    expect(friend.app.room!.view.status).toBe('lobby');

    // The friend leaves and is back on the home screen; the host sees the seat free again.
    await tapAction(friend.app, 'leave-room');
    await settle();
    expect(friend.app.room).toBeNull();
    expect(friend.storage.has('414.room')).toBe(false);
    expect(hasAction(friend.app, 'create-room')).toBe(true);
    expect(host.app.room!.view.seats[2].kind).toBe('empty');
  });

  it('only ever shows the player their own cards', async () => {
    const cloud = new FakeCloud();
    const host = player(cloud, 'host-openid', ['阿明']);
    await tapAction(host.app, 'create-room');
    await tapAction(host.app, 'start-online');
    await settle();
    const roomId = host.app.room!.view.roomId;
    const truth = replayGame(cloud.store.rooms.get(roomId)!.game!).state;
    const shown = host.app.room!.state;
    expect(shown.players[0].hand).toEqual(truth.players[0].hand);
    for (const seat of [1, 2, 3] as const) {
      expect(shown.players[seat].hand.length).toBe(truth.players[seat].hand.length);
      expect(shown.players[seat].hand.every((card) => card.id.startsWith('hidden:'))).toBe(true);
    }
    const hidden = new Set(truth.players.slice(1).flatMap((seatState) => seatState.hand.map((card) => card.id)));
    const drawn = host.app.tappable.flatMap((region) => ('cardId' in region ? [region.cardId] : []));
    expect(drawn.some((id) => hidden.has(id))).toBe(false);

    // Picking a card is fine at any time; handing the seat to the AI drops the pick.
    const card = host.app.tappable.find((region): region is Extract<HitRegion, { cardId: string }> => 'cardId' in region)!;
    await host.app.tap(...center(card.rect));
    expect(host.app.room!.selectedCardIds).toEqual([card.cardId]);
    expect(host.canvas.texts.slice(-80).some((text) => text.includes('现在还没有轮到你'))).toBe(false);
    await tapAction(host.app, 'auto-on');
    await settle();
    expect(host.app.room!.selectedCardIds).toEqual([]);
    expect(host.app.room!.snapshot().auto).toBe(true);
    // Alone with three AIs, the AI now plays the whole round out.
    expect(host.app.room!.state.phase).toBe('ROUND_RESULT');
    expect(hasAction(host.app, 'room-lobby')).toBe(true);
  });

  it('remembers the room and rejoins it after the game restarts', async () => {
    const cloud = new FakeCloud();
    const first = player(cloud, 'host-openid', ['阿明']);
    await tapAction(first.app, 'create-room');
    const code = first.app.room!.view.code;

    // Same WeChat user, fresh launch with the stored room id.
    const relaunched = player(cloud, 'host-openid', []);
    for (const [key, value] of first.storage) relaunched.storage.set(key, value);
    await relaunched.app.resumeRoom();
    expect(relaunched.app.room?.view.code).toBe(code);
  });

  it('explains when the cloud is not set up and rejects a bad room code', async () => {
    const canvas = fakeCanvas();
    const host: OnlineHost = {
      transport: () => null,
      prompt: async () => '12',
      share: () => {},
      getItem: () => null,
      setItem: () => {},
    };
    const app = new MiniGameApp({
      context: canvas,
      viewport: { width: 844, height: 390, insetLeft: 0, insetRight: 0, insetTop: 0, insetBottom: 0 },
      random: () => 0.5, setTimeout: () => 0, clearTimeout: () => {}, online: host,
    }, { animationDelayMs: 0 });
    app.render();
    await tapAction(app, 'create-room');
    expect(canvas.texts.some((text) => text.includes('云开发'))).toBe(true);
    await tapAction(app, 'join-room');
    expect(canvas.texts.some((text) => text.includes('6 位数字'))).toBe(true);
    expect(app.room).toBeNull();
  });
});
