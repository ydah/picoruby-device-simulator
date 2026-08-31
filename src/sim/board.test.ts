import { describe, expect, it } from 'vitest';
import { parseBoard, wiringWarnings } from './board';
import { PicoSimCore } from './PicoSim';

describe('board.yml', () => {
  it('rejects duplicate part ids', () => {
    const source = 'board: pico_w\nparts:\n  - {id: x, type: led, at: [0, 0]}\n  - {id: x, type: led, at: [1, 1]}\nconnections: []';
    expect(() => parseBoard(source)).toThrow('Invalid or duplicate part');
  });

  it('warns about missing ground', () => {
    const config = parseBoard('board: pico_w\nparts:\n  - {id: led1, type: led, at: [0, 0]}\nconnections:\n  - [led1.anode, gpio15]');
    expect(wiringWarnings(config)).toEqual(['led1.cathode が gnd に接続されていません']);
  });

  it('rejects unknown, duplicate, and out-of-range endpoints', () => {
    expect(() => parseBoard('board: pico_w\nparts: []\nconnections:\n  - [ghost.pin, gpio1]')).toThrow('Invalid or duplicate part endpoint');
    expect(() => parseBoard('board: pico_w\nparts:\n  - {id: led, type: led, at: [0, 0]}\nconnections:\n  - [led.magic, gpio1]')).toThrow('Invalid or duplicate part endpoint');
    expect(() => parseBoard('board: pico_w\nparts:\n  - {id: led, type: led, at: [0, 0]}\nconnections:\n  - [led.anode, gpioX]')).toThrow('Invalid connection target');
    expect(() => parseBoard('board: pico_w\nparts:\n  - {id: led, type: led, at: [0, 0]}\nconnections:\n  - [led.anode, gpio1]\n  - [led.anode, gpio2]')).toThrow('Invalid or duplicate part endpoint');
    expect(() => parseBoard('board: pico_w\nparts:\n  - {id: led, type: led, at: [0, 0]}\nconnections:\n  - [led.anode, gpio41]')).toThrow('GPIO pin must be from 0 to 40');
  });

  it('routes I2C only over the pins declared by the board', () => {
    const source = `board: pico_w
parts:
  - {id: oled, type: ssd1306, address: 0x3c, at: [0, 0]}
connections:
  - [oled.sda, gpio4]
  - [oled.scl, gpio5]
  - [oled.vcc, 3v3]
  - [oled.gnd, gnd]`;
    const core = new PicoSimCore();
    core.configure(source);
    const connected = core.i2cOpen(4, 5, 100_000);
    const disconnected = core.i2cOpen(8, 9, 100_000);
    expect(core.i2cWrite(connected, 0x3c, [0x00, 0xaf])).toBe(2);
    expect(core.i2cWrite(disconnected, 0x3c, [0x00, 0xaf])).toBe(-1);
  });

  it('rejects duplicate I2C addresses', () => {
    const source = `board: pico_w
parts:
  - {id: oled1, type: ssd1306, address: 0x3c, at: [0, 0]}
  - {id: oled2, type: ssd1306, address: 0x3c, at: [1, 1]}
connections:
  - [oled1.sda, gpio4]
  - [oled1.scl, gpio5]
  - [oled2.sda, gpio4]
  - [oled2.scl, gpio5]`;
    expect(() => new PicoSimCore().configure(source)).toThrow('I2C address is already in use');
  });

  it('keeps the active board intact when replacement is invalid', () => {
    const core = new PicoSimCore();
    core.configure('board: pico_w\nparts:\n  - {id: led, type: led, at: [0, 0]}\nconnections:\n  - [led.anode, gpio1]\n  - [led.cathode, gnd]');
    const bus = core.bus;
    expect(() => core.configure('not: a board')).toThrow();
    expect(core.bus).toBe(bus);
    expect(core.board?.config.parts[0].id).toBe('led');
  });
});
