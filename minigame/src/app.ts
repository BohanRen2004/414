import { DEFAULT_DECK_COUNT, DeckCount } from '../../client/assets/scripts/core/cards/deck';
import { BrowserGameSession, BrowserSessionSnapshot } from '../../web/src/browser-session';
import { Canvas2D, HitRegion, Viewport, drawFrame, hitTest } from './render';
import { ActionId, buildTableScreen } from './screen';

/** What the app needs from its host: WeChat in the real game, a browser page or a fake in tests. */
export interface Platform {
  readonly context: Canvas2D;
  readonly viewport: Viewport;
  /** Uniform random number in [0, 1); only used to pick a fresh seed. */
  random(): number;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AppOptions {
  /** Pause after each shown move; 0 in tests. */
  readonly animationDelayMs?: number;
}

/** Offline single-player table: the human at seat 0 against three basic AIs, drawn on one canvas. */
export class MiniGameApp {
  private session: BrowserGameSession;
  private snapshot: BrowserSessionSnapshot;
  private unsubscribe: () => void;
  private regions: HitRegion[] = [];
  private chosenDeckCount: DeckCount = DEFAULT_DECK_COUNT;
  private helpOpen = false;
  private notice = '';
  private noticeTimer: unknown = null;

  public constructor(private readonly platform: Platform, private readonly options: AppOptions = {}) {
    this.session = this.newSession(this.freshSeed());
    this.snapshot = this.session.snapshot();
    this.unsubscribe = this.session.subscribe((snapshot) => this.show(snapshot));
  }

  public get current(): BrowserGameSession {
    return this.session;
  }

  public get tappable(): readonly HitRegion[] {
    return this.regions;
  }

  public render(): void {
    const screen = buildTableScreen(this.snapshot, this.chosenDeckCount, this.session.seed);
    this.regions = drawFrame(this.platform.context, this.platform.viewport, screen, { help: this.helpOpen, notice: this.notice });
  }

  /** Handle a tap at logical coordinates; resolves when the triggered move and any AI replies are shown. */
  public async tap(x: number, y: number): Promise<void> {
    const region = hitTest(this.regions, x, y);
    if (region === null) return;
    if ('cardId' in region) {
      this.session.toggleCard(region.cardId);
      return;
    }
    await this.perform(region.action);
  }

  public async perform(action: ActionId): Promise<void> {
    switch (action) {
      case 'help': this.helpOpen = true; this.render(); return;
      case 'close-help': this.helpOpen = false; this.render(); return;
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
    }
  }

  private show(snapshot: BrowserSessionSnapshot): void {
    this.snapshot = snapshot;
    this.render();
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
