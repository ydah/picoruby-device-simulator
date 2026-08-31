export type PinMode = 'in' | 'out' | 'pwm' | 'adc' | 'unset';

export interface PinEvent {
  t: number;
  pin: number;
  v: number;
}

export class PinBus {
  readonly history: PinEvent[] = [];
  private readonly values = new Float64Array(41);
  private readonly modes: PinMode[] = new Array(41).fill('unset');
  private readonly listeners = new Map<number, Set<(value: number) => void>>();

  setMode(pin: number, mode: PinMode, pull = 0): void {
    this.assertPin(pin);
    this.modes[pin] = mode;
    if (mode === 'in') this.write(pin, pull === 8 ? 1 : 0, 0, false);
  }

  mode(pin: number): PinMode {
    this.assertPin(pin);
    return this.modes[pin];
  }

  write(pin: number, value: number, t: number, record = true): void {
    this.assertPin(pin);
    if (!Number.isFinite(value) || !Number.isFinite(t)) throw new TypeError('Pin value and time must be finite numbers');
    if (this.values[pin] === value) return;
    this.values[pin] = value;
    if (record) {
      this.history.push({ t, pin, v: value });
      // ponytail: array-backed cap; use a ring buffer if sustained high-rate traces matter.
      if (this.history.length > 10_000) this.history.shift();
    }
    this.listeners.get(pin)?.forEach((listener) => listener(value));
  }

  read(pin: number): number {
    this.assertPin(pin);
    return this.values[pin];
  }

  onChange(pin: number, listener: (value: number) => void): () => void {
    this.assertPin(pin);
    const listeners = this.listeners.get(pin) ?? new Set();
    listeners.add(listener);
    this.listeners.set(pin, listeners);
    return () => listeners.delete(listener);
  }

  reset(): void {
    this.values.fill(0);
    this.modes.fill('unset');
    this.history.length = 0;
    this.listeners.clear();
  }

  clearHistory(): void {
    this.history.length = 0;
  }

  private assertPin(pin: number): void {
    if (!Number.isInteger(pin) || pin < 0 || pin > 40) {
      throw new RangeError(`GPIO pin must be an integer from 0 to 40: ${pin}`);
    }
  }
}
