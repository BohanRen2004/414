/**
 * Table sounds, synthesised with Web Audio so the page ships no audio files. Browsers only allow sound
 * after the player has touched the page, so the context starts on the first press (unlockAudio).
 */

export type SoundKind = 'select' | 'play' | 'pass' | 'cha' | 'bomb' | 'turn' | 'win' | 'lose';

const MUTE_KEY = '414.muted';

let context: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the choice lasts for this visit only.
  }
}

/** Call from a user gesture; creates or resumes the audio context. */
export function unlockAudio(): void {
  if (muted) return;
  try {
    if (context === null) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return;
      context = new Ctor();
    }
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number,
  options: { type?: OscillatorType; gain?: number; slideTo?: number } = {}): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  if (options.slideTo !== undefined) oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, start + duration);
  const peak = options.gain ?? 0.18;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function noise(ctx: AudioContext, start: number, duration: number,
  options: { gain?: number; filter?: BiquadFilterType; from?: number; to?: number } = {}): void {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter ?? 'highpass';
  filter.frequency.setValueAtTime(options.from ?? 1800, start);
  if (options.to !== undefined) filter.frequency.exponentialRampToValueAtTime(options.to, start + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.gain ?? 0.3, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
}

export function playSound(kind: SoundKind): void {
  if (muted || context === null || context.state !== 'running') return;
  const ctx = context;
  const now = ctx.currentTime + 0.005;
  switch (kind) {
    case 'select':
      tone(ctx, 1320, now, 0.05, { type: 'triangle', gain: 0.06 });
      return;
    case 'play':
      noise(ctx, now, 0.09, { gain: 0.35, from: 1400 });
      tone(ctx, 220, now, 0.08, { type: 'triangle', gain: 0.12, slideTo: 140 });
      return;
    case 'pass':
      tone(ctx, 520, now, 0.12, { gain: 0.08 });
      tone(ctx, 390, now + 0.1, 0.16, { gain: 0.07 });
      return;
    case 'cha':
      noise(ctx, now, 0.08, { gain: 0.3, from: 1600 });
      tone(ctx, 660, now + 0.02, 0.18, { type: 'square', gain: 0.06, slideTo: 990 });
      return;
    case 'bomb':
      noise(ctx, now, 0.7, { gain: 0.6, filter: 'lowpass', from: 1200, to: 80 });
      tone(ctx, 110, now, 0.6, { type: 'sine', gain: 0.45, slideTo: 38 });
      tone(ctx, 55, now + 0.03, 0.5, { type: 'triangle', gain: 0.3, slideTo: 30 });
      return;
    case 'turn':
      tone(ctx, 880, now, 0.12, { gain: 0.09 });
      tone(ctx, 1320, now + 0.09, 0.2, { gain: 0.08 });
      return;
    case 'win':
      [523, 659, 784, 1047].forEach((frequency, index) => tone(ctx, frequency, now + index * 0.12, 0.3, { type: 'triangle', gain: 0.14 }));
      return;
    case 'lose':
      [392, 330, 262].forEach((frequency, index) => tone(ctx, frequency, now + index * 0.16, 0.34, { type: 'triangle', gain: 0.11 }));
      return;
  }
}
