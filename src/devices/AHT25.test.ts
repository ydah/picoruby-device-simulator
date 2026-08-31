import { describe, expect, it } from 'vitest';
import { AHT25 } from './AHT25';

describe('AHT25 controls', () => {
  it('clamps invalid environment values', () => {
    const sensor = new AHT25('sensor', { x: 0, y: 0 });
    sensor.temperature = 999;
    sensor.humidity = -1;
    expect(sensor.temperature).toBe(150);
    expect(sensor.humidity).toBe(0);
    sensor.temperature = Number.NaN;
    sensor.humidity = Number.NaN;
    expect(sensor.temperature).toBe(24);
    expect(sensor.humidity).toBe(50);
  });
});
