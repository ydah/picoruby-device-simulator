export type ClockMode = 'realtime' | 'fast' | 'step';

export class Clock {
  private time = 0;
  mode: ClockMode = 'realtime';

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }

  reset(): void {
    this.time = 0;
  }

  get speed(): number {
    return this.mode === 'fast' ? 10 : 1;
  }
}
