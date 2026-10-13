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

interface WxApi {
  getSystemInfoSync(): WxWindowInfo;
  createCanvas(): WxCanvas;
  onTouchStart(handler: (event: WxTouchEvent) => void): void;
  onTouchEnd(handler: (event: WxTouchEvent) => void): void;
  showShareMenu?(options: { withShareTicket?: boolean; menus?: string[] }): void;
}

declare const wx: WxApi;
/** The mini game's global object (there is no window). */
declare const GameGlobal: Record<string, unknown>;
