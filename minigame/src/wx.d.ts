/** The few WeChat mini-game APIs this game uses (https://developers.weixin.qq.com/minigame/dev/api/). */

interface WxTouch {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface WxTouchEvent {
  readonly touches: readonly WxTouch[];
  readonly changedTouches: readonly WxTouch[];
}

interface WxSafeArea {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface WxWindowInfo {
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly pixelRatio: number;
  readonly safeArea?: WxSafeArea;
}

interface WxCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): import('./render').Canvas2D & { scale(x: number, y: number): void };
}

interface WxCloudWatcher {
  close(): Promise<unknown>;
}

interface WxCloud {
  init(options: { env?: string; traceUser?: boolean }): void;
  callFunction(options: { name: string; data: unknown }): Promise<{ result: unknown }>;
  database(): {
    collection(name: string): {
      where(condition: Record<string, unknown>): {
        watch(options: { onChange: (snapshot: unknown) => void; onError: (error: unknown) => void }): WxCloudWatcher;
      };
    };
  };
}

interface WxLaunchOptions {
  readonly query?: Record<string, string | undefined>;
}

interface WxShareInfo {
  title?: string;
  query?: string;
}

interface WxApi {
  readonly cloud?: WxCloud;
  getLaunchOptionsSync(): WxLaunchOptions;
  onShow(handler: (options: WxLaunchOptions) => void): void;
  shareAppMessage(options: WxShareInfo): void;
  onShareAppMessage?(handler: () => WxShareInfo): void;
  showModal(options: {
    title: string;
    content?: string;
    editable?: boolean;
    placeholderText?: string;
    confirmText?: string;
    success?: (result: { confirm: boolean; cancel: boolean; content?: string }) => void;
    fail?: () => void;
  }): void;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  getSystemInfoSync(): WxWindowInfo;
  createCanvas(): WxCanvas;
  onTouchStart(handler: (event: WxTouchEvent) => void): void;
  onTouchEnd(handler: (event: WxTouchEvent) => void): void;
  showShareMenu?(options: { withShareTicket?: boolean; menus?: string[] }): void;
}

declare const wx: WxApi;
/** The mini game's global object (there is no window). */
declare const GameGlobal: Record<string, unknown>;
