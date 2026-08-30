import { describe, expect, it, vi } from 'vitest';
import { PinBus } from './PinBus';

describe('PinBus', () => {
  it('applies pull-up and records only changes', () => {
    const bus = new PinBus();
    const listener = vi.fn();
    bus.onChange(14, listener);
    bus.setMode(14, 'in', 8);
    bus.write(14, 0, 25);
    bus.write(14, 0, 30);

    expect(bus.read(14)).toBe(0);
    expect(bus.history).toEqual([{ t: 25, pin: 14, v: 0 }]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid pins at the boundary', () => {
    expect(() => new PinBus().read(41)).toThrow(RangeError);
  });
});
