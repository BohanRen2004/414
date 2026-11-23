/**
 * Table sounds for the mini game, synthesised into small WAV files (the same recipes as the web version's
 * Web Audio sounds), so the package ships no audio. game.ts writes each one to the user data folder once and
 * plays it with an InnerAudioContext.
 */

export type SoundKind = 'select' | 'play' | 'pass' | 'cha' | 'bomb' | 'turn' | 'win' | 'lose';

export const SOUND_KINDS: readonly SoundKind[] = ['select', 'play', 'pass', 'cha', 'bomb', 'turn', 'win', 'lose'];

const RATE = 22050;

interface Tone { readonly at: number; readonly duration: number; readonly from: number; readonly to?: number; readonly gain: number; readonly shape?: 'sine' | 'triangle' | 'square' }
interface Noise { readonly at: number; readonly duration: number; readonly gain: number; readonly lowpass?: boolean }

const RECIPES: Readonly<Record<SoundKind, { readonly tones: readonly Tone[]; readonly noises: readonly Noise[] }>> = {
  select: { tones: [{ at: 0, duration: 0.05, from: 1320, gain: 0.2, shape: 'triangle' }], noises: [] },
  play: { tones: [{ at: 0, duration: 0.08, from: 220, to: 140, gain: 0.35, shape: 'triangle' }], noises: [{ at: 0, duration: 0.09, gain: 0.5 }] },
  pass: { tones: [{ at: 0, duration: 0.12, from: 520, gain: 0.25 }, { at: 0.1, duration: 0.16, from: 390, gain: 0.22 }], noises: [] },
  cha: { tones: [{ at: 0.02, duration: 0.18, from: 660, to: 990, gain: 0.18, shape: 'square' }], noises: [{ at: 0, duration: 0.08, gain: 0.4 }] },
  bomb: {
    tones: [{ at: 0, duration: 0.6, from: 110, to: 38, gain: 0.7 }, { at: 0.03, duration: 0.5, from: 55, to: 30, gain: 0.5, shape: 'triangle' }],
    noises: [{ at: 0, duration: 0.7, gain: 0.8, lowpass: true }],
  },
  turn: { tones: [{ at: 0, duration: 0.12, from: 880, gain: 0.28 }, { at: 0.09, duration: 0.2, from: 1320, gain: 0.25 }], noises: [] },
  win: { tones: [523, 659, 784, 1047].map((from, index) => ({ at: index * 0.12, duration: 0.3, from, gain: 0.3, shape: 'triangle' as const })), noises: [] },
  lose: { tones: [392, 330, 262].map((from, index) => ({ at: index * 0.16, duration: 0.34, from, gain: 0.26, shape: 'triangle' as const })), noises: [] },
};

function envelope(t: number, duration: number): number {
  if (t < 0 || t > duration) return 0;
  const attack = 0.01;
  return t < attack ? t / attack : Math.exp(-5 * (t - attack) / duration);
}

function wave(shape: Tone['shape'], phase: number): number {
  const cycle = phase - Math.floor(phase);
  if (shape === 'square') return cycle < 0.5 ? 1 : -1;
  if (shape === 'triangle') return 4 * Math.abs(cycle - 0.5) - 1;
  return Math.sin(2 * Math.PI * cycle);
}

/** Samples in [-1, 1] at 22.05 kHz. The noise is seeded, so a sound is the same every time. */
export function synthesize(kind: SoundKind): Float32Array {
  const recipe = RECIPES[kind];
  const length = Math.max(...[...recipe.tones, ...recipe.noises].map((part) => part.at + part.duration));
  const samples = new Float32Array(Math.ceil(length * RATE) + 1);
  for (const tone of recipe.tones) {
    let phase = 0;
    const start = Math.floor(tone.at * RATE);
    const count = Math.floor(tone.duration * RATE);
    for (let index = 0; index < count; index += 1) {
      const t = index / RATE;
      const frequency = tone.to === undefined ? tone.from : tone.from * (tone.to / tone.from) ** (t / tone.duration);
      phase += frequency / RATE;
      samples[start + index]! += wave(tone.shape, phase) * tone.gain * envelope(t, tone.duration);
    }
  }
  let seed = 0x2545f491;
  for (const noise of recipe.noises) {
    const start = Math.floor(noise.at * RATE);
    const count = Math.floor(noise.duration * RATE);
    let low = 0;
    let previous = 0;
    for (let index = 0; index < count; index += 1) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const white = ((seed >>> 0) / 0x1_0000_0000) * 2 - 1;
      // A one-pole low-pass for a dull boom, or white minus its low-pass for a bright slap.
      const smoothing = noise.lowpass === true ? 0.02 + 0.2 * (1 - index / count) : 0.25;
      low += (white - low) * smoothing;
      const value = noise.lowpass === true ? low * 3 : white - low;
      previous = value;
      samples[start + index]! += previous * noise.gain * (1 - index / count);
    }
  }
  return samples;
}

/** A 16-bit mono PCM WAV file. */
export function wavFile(kind: SoundKind): ArrayBuffer {
  const samples = synthesize(kind);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, Math.round(clamped * 0x7fff), true);
  }
  return buffer;
}
