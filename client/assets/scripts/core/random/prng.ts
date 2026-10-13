export interface RandomSource {
  nextUint32(): number;
  nextInt(maxExclusive: number): number;
  snapshot(): number;
}

export class XorShift32 implements RandomSource {
  private state: number;

  public constructor(seed: number) {
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }

  public nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  public nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
      throw new RangeError('maxExclusive must be an integer in [1, 2^32]');
    }

    const range = 0x1_0000_0000;
    const acceptanceLimit = range - (range % maxExclusive);
    let value: number;
    do {
      value = this.nextUint32();
    } while (value >= acceptanceLimit);
    return value % maxExclusive;
  }

  public snapshot(): number {
    return this.state;
  }
}

export type RandomStream = 'DEAL';

const STREAM_SALT: Readonly<Record<RandomStream, number>> = { DEAL: 0xa341316c };

export function deriveSeed(rootSeed: number, stream: RandomStream): number {
  return (rootSeed ^ STREAM_SALT[stream]) >>> 0;
}
