import type { I2CDevice } from '../sim/I2CBus';
import type { PinBus } from '../sim/PinBus';
import type { Point, SimDevice } from '../sim/types';

interface TextItem { x: number; y: number; text: string; scale: number }

export class SSD1306 implements SimDevice, I2CDevice {
  readonly type = 'ssd1306';
  readonly framebuffer = new Uint8Array(128 * 8);
  private readonly texts: TextItem[] = [];
  private page = 0;
  private column = 0;
  private columnStart = 0;
  private columnEnd = 127;
  private pageStart = 0;
  private pageEnd = 7;
  private addressing: 'horizontal' | 'page' = 'page';
  private displayOn = true;
  private inverted = false;

  constructor(readonly id: string, readonly at: Point, readonly address = 0x3c) {}

  attach(_bus: PinBus): void {}

  write(data: Uint8Array): number {
    if (data[0] === 0x40) this.writeData(data.subarray(1));
    if (data[0] === 0x00) this.commands(data.subarray(1));
    return data.length;
  }

  read(length: number): Uint8Array {
    return new Uint8Array(length);
  }

  clear(): void {
    this.framebuffer.fill(0);
    this.texts.length = 0;
  }

  fill(pattern: number): void {
    this.framebuffer.fill(pattern & 0xff);
    this.texts.length = 0;
  }

  pixel(x: number, y: number, value: number): void {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
    const index = Math.floor(y / 8) * 128 + x;
    const mask = 1 << (y % 8);
    this.framebuffer[index] = value ? this.framebuffer[index] | mask : this.framebuffer[index] & ~mask;
  }

  text(x: number, y: number, text: string, scale = 1): void {
    this.texts.push({ x, y, text, scale });
  }

  render(ctx: CanvasRenderingContext2D): void {
    const x0 = this.at.x - 128;
    const y0 = this.at.y - 64;
    ctx.fillStyle = '#334155';
    ctx.fillRect(x0 - 9, y0 - 9, 274, 146);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x0 - 5, y0 - 5, 266, 138);
    ctx.fillStyle = this.inverted && this.displayOn ? '#99f6e4' : '#06101b';
    ctx.fillRect(x0, y0, 256, 128);
    if (!this.displayOn) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, 256, 128);
    ctx.clip();
    ctx.fillStyle = this.inverted ? '#06101b' : '#99f6e4';
    for (let page = 0; page < 8; page++) {
      for (let column = 0; column < 128; column++) {
        const byte = this.framebuffer[page * 128 + column];
        if (!byte) continue;
        for (let bit = 0; bit < 8; bit++) {
          if (byte & (1 << bit)) ctx.fillRect(x0 + column * 2, y0 + (page * 8 + bit) * 2, 2, 2);
        }
      }
    }
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    this.texts.forEach(({ x, y, text, scale }) => {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.fillText(text, (x0 + x * 2) / scale, (y0 + y * 2 + 12) / scale);
      ctx.restore();
    });
    ctx.restore();
  }

  private writeData(data: Uint8Array): void {
    data.forEach((byte) => {
      this.framebuffer[this.page * 128 + this.column] = byte;
      this.column++;
      if (this.column <= this.columnEnd) return;
      this.column = this.columnStart;
      if (this.addressing === 'horizontal') this.page = this.page >= this.pageEnd ? this.pageStart : this.page + 1;
    });
  }

  private commands(data: Uint8Array): void {
    let rangeChanged = false;
    for (let i = 0; i < data.length; i++) {
      const command = data[i];
      if (command === 0xae || command === 0xaf) this.displayOn = command === 0xaf;
      else if (command === 0xa6 || command === 0xa7) this.inverted = command === 0xa7;
      else if (command >= 0xb0 && command <= 0xb7) this.page = command - 0xb0;
      else if (command <= 0x0f) this.column = (this.column & 0xf0) | command;
      else if (command >= 0x10 && command <= 0x1f) this.column = (this.column & 0x0f) | ((command & 0x0f) << 4);
      else if (command === 0x20) this.addressing = data[++i] === 0 ? 'horizontal' : 'page';
      else if (command === 0x21) {
        [this.columnStart, this.columnEnd] = [data[++i] ?? 0, data[++i] ?? 127];
        rangeChanged = true;
      } else if (command === 0x22) {
        [this.pageStart, this.pageEnd] = [data[++i] ?? 0, data[++i] ?? 7];
        rangeChanged = true;
      }
      else if ([0x81, 0xa8, 0xd3, 0xd5, 0xd9, 0xda, 0xdb, 0x8d].includes(command)) i++;
    }
    if (rangeChanged) {
      this.column = this.columnStart;
      this.page = this.pageStart;
    }
  }
}
