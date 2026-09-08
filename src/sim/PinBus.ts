export type PinMode = 'in' | 'out' | 'pwm' | 'adc' | 'unset';

export interface PinEvent {
  t: number;
  pin: number;
  v: number;
}

export class PinBus {
  readonly history: PinEvent[] = [];
  version = 0;
  readonly pwmFrequency = new Map<number, number>();
  private readonly inputs = new Map<number, number>();
  private readonly pulls = new Map<number, number>();
  private readonly initial = new Float64Array(30);
  private readonly values = new Float64Array(30);
  private readonly modes: PinMode[] = new Array(30).fill('unset');
  private readonly listeners = new Map<number, Set<(value: number) => void>>();

  setMode(pin: number, mode: PinMode, pull = 0): void {
    this.assertPin(pin);
    this.modes[pin] = mode;
    this.pulls.set(pin, pull === 8 ? 1 : 0);
    if (mode !== 'pwm') this.pwmFrequency.delete(pin);
    if (mode === 'in' || mode === 'adc') this.write(pin, this.inputs.get(pin) ?? this.pulls.get(pin) ?? 0, 0, false);
  }

  driveInput(pin: number, value: number | undefined, t: number): void {
    this.assertPin(pin);
    if (value !== undefined && !Number.isFinite(value)) throw new TypeError('Input must be finite');
    if (value === undefined) this.inputs.delete(pin);
    else this.inputs.set(pin, value);
    if (this.mode(pin) !== 'out' && this.mode(pin) !== 'pwm') this.write(pin, value ?? this.pulls.get(pin) ?? 0, t);
  }

  mode(pin: number): PinMode {
    this.assertPin(pin);
    return this.modes[pin];
  }

  write(pin: number, value: number, t: number, record = true): void {
    this.assertPin(pin);
    if (!Number.isFinite(value) || !Number.isFinite(t)) throw new TypeError('Pin value and time must be finite numbers');
    const changed = this.values[pin] !== value;
    if (!changed) return;
    this.values[pin] = value;
    if (record && changed) {
      this.version++;
      this.history.push({ t, pin, v: value });
      // ponytail: array-backed cap; use a ring buffer if sustained high-rate traces matter.
      if (this.history.length > 10_000) {
        const removed = this.history.shift();
        if (removed) this.initial[removed.pin] = removed.v;
      }
    }
    this.notify(pin);
  }

  notify(pin: number): void { this.listeners.get(pin)?.forEach(listener => listener(this.read(pin))); }

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
    this.inputs.clear();
    this.pulls.clear();
    this.pwmFrequency.clear();
    this.initial.fill(0);
  }

  resetOutputs(): void {
    this.modes.fill('unset');
    this.pulls.clear();
    this.pwmFrequency.clear();
    for (let pin = 0; pin < this.values.length; pin++) {
      this.values[pin] = this.inputs.get(pin) ?? 0;
      this.notify(pin);
    }
    this.clearHistory();
  }

  initialValue(pin: number): number { return this.initial[pin]; }

  clearHistory(): void {
    this.history.length = 0;
    this.initial.set(this.values);
  }

  private assertPin(pin: number): void {
    if (!Number.isInteger(pin) || pin < 0 || pin > 29) {
      throw new RangeError(`GPIO pin must be an integer from 0 to 29: ${pin}`);
    }
  }
}
