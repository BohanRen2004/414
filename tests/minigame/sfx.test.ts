import { describe, expect, it } from 'vitest';
import { SOUND_KINDS, synthesize, wavFile } from '../../minigame/src/sfx';

describe('mini game sounds', () => {
  it.each(SOUND_KINDS)('synthesises a short, audible, clean %s sound', (kind) => {
    const samples = synthesize(kind);
    expect(samples.length).toBeGreaterThan(22050 * 0.04);
    expect(samples.length).toBeLessThan(22050 * 1);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(samples.every(Number.isFinite)).toBe(true);
    // Deterministic: the same file every time.
    expect(synthesize(kind)).toEqual(samples);
  });

  it('writes a valid 16-bit mono WAV file', () => {
    const file = new DataView(wavFile('bomb'));
    const tag = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((index) => file.getUint8(offset + index)));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(file.getUint16(22, true)).toBe(1);
    expect(file.getUint32(24, true)).toBe(22050);
    expect(file.getUint16(34, true)).toBe(16);
    expect(file.getUint32(40, true)).toBe(file.byteLength - 44);
  });
});
