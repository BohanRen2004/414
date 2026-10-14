import { DEFAULT_DECK_COUNT, DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { RoomResponse } from '../../client/assets/scripts/online/protocol';
import { errorMessage } from '../../client/assets/scripts/ui/labels';
import { BrowserGameSession, BrowserSessionSnapshot } from '../../web/src/browser-session';
import { OnlineSession, OnlineSnapshot, RoomTransport } from './online-session';
import { Canvas2D, HitRegion, Viewport, drawFrame, drawLobbyFrame, hitTest } from './render';
import { ActionId, buildLobbyScreen, buildTableScreen } from './screen';

/** What online play needs from the host: the cloud, a text prompt, sharing and local storage. */
export interface OnlineHost {
  /** The room cloud function; null when cloud development is not available (e.g. a test AppID). */
  transport(): RoomTransport | null;
  /** Ask for one line of text; null when cancelled. */
  prompt(title: string, placeholder: string): Promise<string | null>;
  /** Send a share card that opens the game with `query`. */
  share(title: string, query: string): void;
  getItem(key: string): string | null;
  setItem(key: string, value: string | null): void;
}

/** What the app needs from its host: WeChat in the real game, a browser page or a fake in tests. */
export interface Platform {
  readonly context: Canvas2D;
  readonly viewport: Viewport;
  /** Uniform random number in [0, 1); only used to pick a fresh seed. */
  random(): number;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now?(): number;
  readonly online?: OnlineHost;
}

export interface AppOptions {
  /** Pause after each shown move; 0 in tests. */
  readonly animationDelayMs?: number;
}

const ROOM_KEY = '414.room';
const NICKNAME_KEY = '414.nickname';
const SEAT_ACTIONS: Partial<Record<ActionId, 0 | 1 | 2 | 3>> = { 'seat-0': 0, 'seat-1': 1, 'seat-2': 2, 'seat-3': 3 };

/**
 * The mini game: an offline table against three AIs (its start screen is also the home screen), or an
 * online room through the cloud function, drawn on one canvas.
 */
export class MiniGameApp {
  private session: BrowserGameSession;
  private snapshot: BrowserSessionSnapshot;
  private unsubscribe: () => void;
  private online: OnlineSession | null = null;
  private onlineSnapshot: OnlineSnapshot | null = null;
  private unsubscribeOnline: () => void = () => {};
  private transport: RoomTransport | null | undefined;
  private regions: HitRegion[] = [];
  private chosenDeckCount: DeckCount = DEFAULT_DECK_COUNT;
  private helpOpen = false;
  private notice = '';
  private noticeTimer: unknown = null;
  private clockTimer: unknown = null;
  private joining = false;

  public constructor(private readonly platform: Platform, private readonly options: AppOptions = {}) {
    this.session = this.newSession(this.freshSeed());
    this.snapshot = this.session.snapshot();
    this.unsubscribe = this.session.subscribe((snapshot) => this.show(snapshot));
  }

  /** The offline session (the home screen when no room is open). */
  public get current(): BrowserGameSession {
    return this.session;
  }

  public get room(): OnlineSession | null {
    return this.online;
  }

  public get tappable(): readonly HitRegion[] {
    return this.regions;
  }

  public render(): void {
    const overlay = { help: this.helpOpen, notice: this.notice };
    const online = this.online;
    const onlineSnapshot = this.onlineSnapshot;
    if (online !== null && onlineSnapshot !== null) {
      const room = onlineSnapshot.room;
      if (room.status === 'lobby') {
        this.regions = drawLobbyFrame(this.platform.context, this.platform.viewport,
          buildLobbyScreen(room, onlineSnapshot.isBusy, onlineSnapshot.errorCode), overlay);
        return;
      }
      const screen = buildTableScreen(onlineSnapshot, room.deckCount, 0,
        { room, secondsLeft: onlineSnapshot.secondsLeft, auto: onlineSnapshot.auto });
      this.regions = drawFrame(this.platform.context, this.platform.viewport, screen, overlay);
      return;
    }
    const screen = buildTableScreen(this.snapshot, this.chosenDeckCount, this.session.seed, null, this.platform.online !== undefined);
    this.regions = drawFrame(this.platform.context, this.platform.viewport, screen, overlay);
  }

  /** Handle a tap at logical coordinates; resolves when the triggered move and any replies are shown. */
  public async tap(x: number, y: number): Promise<void> {
    const region = hitTest(this.regions, x, y);
    if (region === null) return;
    if ('cardId' in region) {
      if (this.online !== null) this.online.toggleCard(region.cardId);
      else this.session.toggleCard(region.cardId);
      return;
    }
    await this.perform(region.action);
  }

  public async perform(action: ActionId): Promise<void> {
    if (action === 'help') { this.helpOpen = true; this.render(); return; }
    if (action === 'close-help') { this.helpOpen = false; this.render(); return; }
    if (this.online !== null) {
      await this.performOnline(this.online, action);
      return;
    }
    switch (action) {
      case 'deck-1':
      case 'deck-2':
        this.chosenDeckCount = action === 'deck-1' ? 1 : 2;
        this.replace(this.newSession(this.session.seed));
        return;
      case 'start':
        if (!await this.session.start()) this.flash(`无法开始游戏：${this.session.lastErrorCode ?? '未知错误'}`);
        return;
      case 'new-game': this.replace(this.newSession(this.freshSeed())); return;
      case 'replay':
        this.replace(this.session.replay());
        await this.session.start();
        return;
      case 'hint': this.session.cycleHint(); return;
      case 'clear': this.session.clearSelection(); return;
      case 'pass': await this.session.pass(); return;
      case 'play':
        if (!await this.session.playSelection()) this.flash('请选择合法牌型后再出牌。');
        return;
      case 'confirm-goucha':
        if (!await this.session.submitGouCha()) this.flash('请选择要求的同点数牌。');
        return;
      case 'decline-goucha': await this.session.declineGouCha(); return;
      case 'create-room': await this.createRoom(); return;
      case 'join-room': {
        const code = await this.platform.online?.prompt('加入房间', '输入 6 位房间号');
        if (code !== null && code !== undefined) await this.joinRoom(code);
        return;
      }
      default: return;
    }
  }

  // --- Online -------------------------------------------------------------------------------------------

  /** Join a room by its code, e.g. from a share card's `room=` query. */
  public async joinRoom(code: string): Promise<void> {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      this.flash('房间号是 6 位数字。');
      return;
    }
    if (this.online !== null) {
      if (this.online.view.code === trimmed) return;
      this.flash('请先离开当前房间。');
      return;
    }
    await this.openRoom(async (transport, nickname) => transport.call({ type: 'join', code: trimmed, nickname }));
  }

  /** Reopen the room this player was in before the game was closed, if it is still going. */
  public async resumeRoom(): Promise<void> {
    const host = this.platform.online;
    const roomId = host?.getItem(ROOM_KEY) ?? null;
    if (host === undefined || roomId === null || this.online !== null) return;
    const transport = this.cloud();
    if (transport === null) return;
    try {
      const response = await transport.call({ type: 'sync', roomId, cursor: null });
      if (response.ok && response.room.mySeat !== null && response.room.status !== 'closed') this.enterRoom(transport, response);
      else host.setItem(ROOM_KEY, null);
    } catch {
      // Offline at launch: stay on the home screen.
    }
  }

  private async createRoom(): Promise<void> {
    const deckCount = this.chosenDeckCount;
    await this.openRoom(async (transport, nickname) => transport.call({ type: 'create', nickname, deckCount }));
  }

  private async openRoom(open: (transport: RoomTransport, nickname: string) => Promise<RoomResponse>): Promise<void> {
    if (this.joining) return;
    const transport = this.cloud();
    if (transport === null) {
      this.flash('联机需要开通微信云开发（见 minigame/README.md）。');
      return;
    }
    this.joining = true;
    try {
      const nickname = await this.nickname();
      const response = await open(transport, nickname);
      if (!response.ok) {
        this.flash(errorMessage(response.code));
        return;
      }
      this.enterRoom(transport, response);
    } catch {
      this.flash('连不上服务器：请确认云函数 room 已部署。');
    } finally {
      this.joining = false;
    }
  }

  private enterRoom(transport: RoomTransport, response: Extract<RoomResponse, { ok: true }>): void {
    this.helpOpen = false;
    const now = this.platform.now ?? (() => Date.now());
    const online = new OnlineSession(transport, {
      setTimeout: (handler, ms) => this.platform.setTimeout(handler, ms),
      clearTimeout: (handle) => this.platform.clearTimeout(handle),
      now,
    }, response, this.options.animationDelayMs === undefined ? {} : { animationDelayMs: this.options.animationDelayMs });
    this.online = online;
    this.platform.online?.setItem(ROOM_KEY, response.room.roomId);
    this.unsubscribeOnline = online.subscribe((snapshot) => this.showOnline(snapshot));
  }

  private leaveRoomView(message: string): void {
    this.unsubscribeOnline();
    this.online?.close();
    this.online = null;
    this.onlineSnapshot = null;
    this.platform.online?.setItem(ROOM_KEY, null);
    this.replace(this.newSession(this.freshSeed()));
    if (message) this.flash(message);
  }

  private async performOnline(online: OnlineSession, action: ActionId): Promise<void> {
    const seat = SEAT_ACTIONS[action];
    if (seat !== undefined) {
      await online.moveSeat(seat);
      return;
    }
    switch (action) {
      case 'deck-1': await online.setDeckCount(1); return;
      case 'deck-2': await online.setDeckCount(2); return;
      case 'start-online': await online.start(); return;
      case 'invite': {
        const code = online.view.code;
        this.platform.online?.share(`来打 4A4！房间号 ${code}`, `room=${code}`);
        return;
      }
      case 'leave-room':
        // Stop listening first, so the reply that drops this player's seat is not taken for a closed room.
        this.unsubscribeOnline();
        await online.leave();
        this.leaveRoomView('');
        return;
      case 'room-lobby': await online.backToLobby(); return;
      case 'auto-on': await online.setAuto(true); return;
      case 'auto-off': await online.setAuto(false); return;
      case 'hint': online.cycleHint(); return;
      case 'clear': online.clearSelection(); return;
      case 'pass': await online.pass(); return;
      case 'play':
        if (!await online.playSelection() && online.lastErrorCode === null) this.flash('请选择合法牌型后再出牌。');
        return;
      case 'confirm-goucha':
        if (!await online.submitGouCha() && online.lastErrorCode === null) this.flash('请选择要求的同点数牌。');
        return;
      case 'decline-goucha': await online.declineGouCha(); return;
      default: return;
    }
  }

  private showOnline(snapshot: OnlineSnapshot): void {
    if (snapshot.room.status === 'closed' || snapshot.room.mySeat === null) {
      this.leaveRoomView('房间已关闭，或你已不在房间里。');
      return;
    }
    this.onlineSnapshot = snapshot;
    this.render();
    // Keep the countdown moving while it is the player's turn.
    if (snapshot.secondsLeft !== null && this.clockTimer === null) {
      this.clockTimer = this.platform.setTimeout(() => {
        this.clockTimer = null;
        if (this.online !== null) this.showOnline(this.online.snapshot());
      }, 1000);
    }
  }

  private cloud(): RoomTransport | null {
    if (this.transport === undefined) this.transport = this.platform.online?.transport() ?? null;
    return this.transport;
  }

  private async nickname(): Promise<string> {
    const host = this.platform.online!;
    const saved = host.getItem(NICKNAME_KEY);
    if (saved !== null && saved.trim() !== '') return saved;
    const typed = (await host.prompt('你的昵称', '朋友们在牌桌上看到的名字'))?.trim() ?? '';
    const nickname = typed === '' ? `玩家${Math.floor(this.platform.random() * 9000 + 1000)}` : typed.slice(0, 12);
    host.setItem(NICKNAME_KEY, nickname);
    return nickname;
  }

  // --- Offline ------------------------------------------------------------------------------------------

  private show(snapshot: BrowserSessionSnapshot): void {
    this.snapshot = snapshot;
    if (this.online === null) this.render();
  }

  private newSession(seed: number): BrowserGameSession {
    const delay = this.options.animationDelayMs;
    return new BrowserGameSession(seed, {
      deckCount: this.chosenDeckCount,
      ...(delay === undefined ? {} : { animationDelayMs: delay }),
    });
  }

  private replace(next: BrowserGameSession): void {
    this.unsubscribe();
    this.helpOpen = false;
    this.session = next;
    this.chosenDeckCount = next.deckCount;
    this.snapshot = next.snapshot();
    this.unsubscribe = next.subscribe((snapshot) => this.show(snapshot));
    this.render();
  }

  private freshSeed(): number {
    return Math.floor(this.platform.random() * 0x1_0000_0000) >>> 0;
  }

  private flash(message: string): void {
    this.notice = message;
    this.render();
    if (this.noticeTimer !== null) this.platform.clearTimeout(this.noticeTimer);
    this.noticeTimer = this.platform.setTimeout(() => {
      this.notice = '';
      this.noticeTimer = null;
      this.render();
    }, 2400);
  }
}
