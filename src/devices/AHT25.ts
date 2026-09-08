import type { I2CDevice } from '../sim/I2CBus';
import type { PinBus } from '../sim/PinBus';
import type { Point, SimDevice } from '../sim/types';

export class AHT25 implements SimDevice, I2CDevice {
  readonly type = 'aht25';
  private _temperature = 24;
  private _humidity = 50;
  private command = 0;

  constructor(readonly id: string, readonly at: Point, readonly address = 0x38) {}

  get temperature(): number { return this._temperature; }
  set temperature(value: number) { this._temperature = Number.isFinite(value) ? Math.max(-50, Math.min(150, value)) : 24; }
  get humidity(): number { return this._humidity; }
  set humidity(value: number) { this._humidity = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50; }

  attach(_bus: PinBus): void {}

  write(data: Uint8Array): number {
    this.command = data[0] ?? 0;
    return data.length;
  }

  read(length: number): Uint8Array {
    if (this.command === 0x71) return new Uint8Array([0x18]).slice(0, length);
    const humidity = Math.min(2 ** 20 - 1, Math.round(this.humidity / 100 * 2 ** 20));
    const temperature = Math.min(2 ** 20 - 1, Math.round((this.temperature + 50) / 200 * 2 ** 20));
    return new Uint8Array([
      0x18,
      humidity >> 12,
      humidity >> 4,
      (humidity << 4) | (temperature >> 16),
      temperature >> 8,
      temperature,
      0,
    ]).slice(0, length);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#172033';
    ctx.fillRect(this.at.x - 44, this.at.y - 27, 88, 54);
    ctx.fillStyle = '#5eead4';
    ctx.font = '600 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.temperature.toFixed(1)} °C`, this.at.x, this.at.y - 5);
    ctx.fillText(`${this.humidity.toFixed(0)} %RH`, this.at.x, this.at.y + 16);
  }
}
