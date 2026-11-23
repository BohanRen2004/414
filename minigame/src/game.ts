import { MiniGameApp, OnlineHost } from './app';
import { createCloudTransport } from './cloud-transport';
import { SOUND_KINDS, SoundKind, wavFile } from './sfx';

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

/**
 * Table sounds: each is synthesised once into a WAV file in the user data folder, then played through a
 * small pool of audio contexts so quick plays can overlap. Any failure just means silence.
 */
const soundFiles = new Map<SoundKind, string>();
function soundFile(kind: SoundKind): string | null {
  const known = soundFiles.get(kind);
  if (known !== undefined) return known;
  try {
    const path = `${wx.env.USER_DATA_PATH}/sfx-v1-${kind}.wav`;
    wx.getFileSystemManager().writeFileSync(path, wavFile(kind));
    soundFiles.set(kind, path);
    return path;
  } catch {
    return null;
  }
}
const voices = Array.from({ length: 4 }, () => {
  try {
    const audio = wx.createInnerAudioContext();
    audio.obeyMuteSwitch = true;
    return audio;
  } catch {
    return null;
  }
});
let nextVoice = 0;
function playSound(kind: SoundKind): void {
  const path = soundFile(kind);
  const voice = voices[nextVoice];
  nextVoice = (nextVoice + 1) % voices.length;
  if (path === null || voice === null || voice === undefined) return;
  try {
    voice.stop();
    voice.src = path;
    voice.play();
  } catch {
    // Audio is a nicety.
  }
}
// Write the files ahead of the first play, after the first frame is up.
setTimeout(() => { for (const kind of SOUND_KINDS) soundFile(kind); }, 500);

function getItem(key: string): string | null {
  try {
    const value = wx.getStorageSync(key);
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

function setItem(key: string, value: string | null): void {
  try {
    if (value === null) wx.removeStorageSync(key);
    else wx.setStorageSync(key, value);
  } catch {
    // Storage full or unavailable: the game works without it.
  }
}

const online: OnlineHost = {
  transport: createCloudTransport,
  prompt: (title, placeholder) => new Promise((resolve) => {
    wx.showModal({
      title,
      editable: true,
      placeholderText: placeholder,
      success: (result) => resolve(result.confirm ? result.content ?? '' : null),
      fail: () => resolve(null),
    });
  }),
  share: (title, query) => wx.shareAppMessage({ title, query }),
  getItem,
  setItem,
};
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
  now: () => Date.now(),
  playSound,
  getItem,
  setItem,
  online,
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

// Touches go to the app: a slide across the hand selects cards, a short touch elsewhere is a tap.
wx.onTouchStart((event) => {
  for (const touch of event.changedTouches) app.touchStart(touch.identifier, touch.clientX, touch.clientY);
});
wx.onTouchMove((event) => {
  for (const touch of event.changedTouches) app.touchMove(touch.identifier, touch.clientX, touch.clientY);
});
wx.onTouchEnd((event) => {
  for (const touch of event.changedTouches) void app.touchEnd(touch.identifier, touch.clientX, touch.clientY);
});
wx.onTouchCancel((event) => {
  for (const touch of event.changedTouches) app.touchCancel(touch.identifier);
});

wx.showShareMenu?.({ withShareTicket: false, menus: ['shareAppMessage'] });
// The share button in the menu invites friends to the open room, if any.
wx.onShareAppMessage?.(() => {
  const code = app.room?.view.code;
  return code === undefined ? { title: '来打 4A4' } : { title: `来打 4A4！房间号 ${code}`, query: `room=${code}` };
});

/**
 * A share card opens the game with `room=<code>`: join that room. Coming back to the foreground repeats the
 * last entry's query, so a code is only acted on once (a player who left is not pulled back in).
 */
let handledCode = '';
function joinFromQuery(query: Record<string, string | undefined> | undefined): boolean {
  const code = query?.room;
  if (code === undefined || code === '' || code === handledCode) return false;
  handledCode = code;
  void app.joinRoom(code);
  return true;
}

// Exposed for debugging in WeChat DevTools and for the browser preview harness.
GameGlobal.__app = app;
app.render();
if (!joinFromQuery(wx.getLaunchOptionsSync().query)) void app.resumeRoom();
wx.onShow((options) => { joinFromQuery(options.query); });
