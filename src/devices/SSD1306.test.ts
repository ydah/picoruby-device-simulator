import { describe, expect, it } from 'vitest';
import { SSD1306 } from './SSD1306';

describe('SSD1306', () => {
  it('writes data in horizontal addressing mode', () => {
    const display = new SSD1306('oled', { x: 0, y: 0 });
    display.write(new Uint8Array([0x00, 0x20, 0x00, 0x21, 2, 3, 0x22, 1, 1]));
    display.write(new Uint8Array([0x40, 0xaa, 0x55]));
    expect([...display.framebuffer.slice(130, 132)]).toEqual([0xaa, 0x55]);
  });
});
