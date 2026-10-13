import { MiniGameApp } from './app';

/** WeChat mini-game entry: one full-screen canvas in landscape, taps forwarded to the app. */

// Older WeChat base libraries lack globalThis; the rules core reads it to decide on invariant checks.
if (typeof globalThis === 'undefined') GameGlobal.globalThis = GameGlobal;

const info = wx.getSystemInfoSync();
const width = info.windowWidth;
const height = info.windowHeight;
const canvas = wx.createCanvas();
canvas.width = Math.round(width * info.pixelRatio);
canvas.height = Math.round(height * info.pixelRatio);
const context = canvas.getContext('2d');
context.scale(info.pixelRatio, info.pixelRatio);

const safe = info.safeArea ?? { left: 0, right: width, top: 0, bottom: height };
const app = new MiniGameApp({
  context,
  viewport: {
    width,
    height,
    insetLeft: Math.max(0, safe.left),
    insetRight: Math.max(0, width - safe.right),
    insetTop: Math.max(0, safe.top),
    insetBottom: Math.max(0, height - safe.bottom),
  },
  random: Math.random,
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

// A tap is a touch that ends close to where it started, so a slide across the hand is not a tap.
const starts = new Map<number, { x: number; y: number }>();
wx.onTouchStart((event) => {
  for (const touch of event.changedTouches) starts.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
});
wx.onTouchEnd((event) => {
  for (const touch of event.changedTouches) {
    const start = starts.get(touch.identifier);
    starts.delete(touch.identifier);
    if (start !== undefined && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12) continue;
    void app.tap(touch.clientX, touch.clientY);
  }
});

wx.showShareMenu?.({ withShareTicket: false, menus: ['shareAppMessage'] });
// Exposed for debugging in WeChat DevTools and for the browser preview harness.
GameGlobal.__app = app;
app.render();
