import { describe, expect, it } from 'vitest';
import { dump } from 'js-yaml';
import { addPart, removePart } from './board-editor';
import { waveformPoints } from './render';
import { AHT25 } from './devices/AHT25';
import { PicoSimCore } from './sim/PicoSim';
import { parseBoard } from './sim/board';
import { GPIO_PINS, pinPosition } from './sim/pins';
import type { BoardConfig } from './sim/types';

describe('interactive simulator', () => {
  it('adds combinable devices, assigns free pins, and removes their wires', () => {
    const board: BoardConfig = { board: 'pico_w', parts: [], connections: [] };
    for (const type of ['led', 'button', 'potentiometer', 'servo', 'ssd1306', 'aht25', 'sk6812', 'ssd1306'] as const) addPart(board, type);
    const core = new PicoSimCore();
    expect(core.configure(dump(board)).devices).toHaveLength(8);
    expect(core.board?.warnings).toEqual([]);
    expect(board.parts.filter(part => part.type === 'ssd1306').map(part => part.address)).toEqual([60, 61]);
    removePart(board, 'led1');
    expect(board.connections.flat().some(endpoint => endpoint.startsWith('led1.'))).toBe(false);
    expect(core.configure(dump(board)).devices).toHaveLength(7);
  });

  it('uses the physical header mapping and rejects hidden GPIOs and invalid part parameters', () => {
    expect(GPIO_PINS).toHaveLength(26);
    expect(pinPosition('gpio15')).toEqual([360, 373]);
    expect(pinPosition('gpio26')).toEqual([440, 223]);
    expect(pinPosition('gpio25')).toBeUndefined();
    const board: BoardConfig = { board: 'pico_w', parts: [{ id: 'led', type: 'led', at: [0, 0] }], connections: [['led.anode', 'gpio25']] };
    expect(() => parseBoard(dump(board))).toThrow('Pico の外部 GPIO');
    board.connections = [];
    board.parts[0].count = -1;
    expect(() => parseBoard(dump(board))).toThrow('LED 数');
  });

  it('preserves held buttons through GPIO initialization and resets outputs without losing analog input', () => {
    const core = new PicoSimCore();
    const board: BoardConfig = { board: 'pico_w', parts: [], connections: [] };
    addPart(board, 'button'); addPart(board, 'potentiometer'); addPart(board, 'led');
    core.configure(dump(board));
    core.buttons()[0].pointer(true);
    core.potentiometers()[0].setValue(12000);
    core.prepareRun();
    core.pinMode(0, 1 | 8);
    expect(core.digitalRead(0)).toBe(0);
    core.buttons()[0].pointer(false);
    expect(core.digitalRead(0)).toBe(1);
    core.digitalWrite(1, 1);
    core.prepareRun();
    expect(core.digitalRead(1)).toBe(0);
    expect(core.adcRead(26)).toBe(12000);
  });

  it('calculates servo angle from pulse width at different frequencies and supports calibration', () => {
    const core = new PicoSimCore();
    core.configure('board: pico_w\nparts:\n  - {id: servo, type: servo, at: [0, 0], pulse_min: 1000, pulse_max: 2000}\nconnections:\n  - [servo.signal, gpio17]');
    core.pwmOpen(17, 50, 7.5);
    expect(core.servos()[0].angle).toBe(90);
    core.pwmWrite(17, 100, 15);
    expect(core.servos()[0].angle).toBe(90);
    core.pwmWrite(17, 50, 15);
    expect(core.servos()[0].angle).toBe(180);
  });

  it('does not wrap maximum sensor readings to zero', () => {
    const sensor = new AHT25('sensor', { x: 0, y: 0 });
    sensor.humidity = 100; sensor.temperature = 150;
    const data = sensor.read(7);
    const humidity = (data[1] << 12 | data[2] << 4 | data[3] >> 4) / 2 ** 20 * 100;
    const temperature = ((data[3] & 15) << 16 | data[4] << 8 | data[5]) / 2 ** 20 * 200 - 50;
    expect(humidity).toBeCloseTo(100, 3);
    expect(temperature).toBeCloseTo(150, 3);
  });

  it('keeps the level at the left edge of the waveform and counts events past the history cap', () => {
    expect(waveformPoints([{ t: 1, pin: 15, v: 1 }, { t: 7000, pin: 15, v: 0 }], 0, 5000, 10000)).toEqual([
      { t: 5000, v: 1 }, { t: 7000, v: 1 }, { t: 7000, v: 0 }, { t: 10000, v: 0 },
    ]);
    const core = new PicoSimCore();
    for (let time = 1; time <= 10001; time++) core.bus.write(15, time % 2, time);
    expect(core.bus.history).toHaveLength(10000);
    expect(core.bus.version).toBe(10001);
    expect(core.bus.initialValue(15)).toBe(1);
  });
});
