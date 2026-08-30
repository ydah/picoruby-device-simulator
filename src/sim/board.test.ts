import { describe, expect, it } from 'vitest';
import { parseBoard, wiringWarnings } from './board';

describe('board.yml', () => {
  it('rejects duplicate part ids', () => {
    const source = 'board: pico_w\nparts:\n  - {id: x, type: led, at: [0, 0]}\n  - {id: x, type: led, at: [1, 1]}\nconnections: []';
    expect(() => parseBoard(source)).toThrow('Invalid or duplicate part');
  });

  it('warns about missing ground', () => {
    const config = parseBoard('board: pico_w\nparts:\n  - {id: led1, type: led, at: [0, 0]}\nconnections:\n  - [led1.anode, gpio15]');
    expect(wiringWarnings(config)).toEqual(['led1.cathode が gnd に接続されていません']);
  });
});
