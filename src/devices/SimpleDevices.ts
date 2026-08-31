import type { Clock } from '../sim/Clock';
import type { PinBus } from '../sim/PinBus';
import type { Point, SimDevice } from '../sim/types';

export class Led implements SimDevice {
  readonly type = 'led';
  private brightness = 0;

  constructor(readonly id: string, readonly at: Point, private readonly pin: number, private readonly color = '#ef4444') {}

  attach(bus: PinBus): void {
    this.brightness = bus.read(this.pin);
    bus.onChange(this.pin, (value) => { this.brightness = Math.max(0, Math.min(1, value)); });
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.at.x, this.at.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = this.brightness ? this.color : '#252b36';
    if (this.brightness) {
      ctx.globalAlpha = Math.max(0.2, this.brightness);
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 24 * this.brightness;
    }
    ctx.fill();
    ctx.restore();
  }
}

export class Button implements SimDevice {
  readonly type = 'button';
  private pressed = false;
  private bus?: PinBus;

  constructor(readonly id: string, readonly at: Point, private readonly pin: number, private readonly clock: Clock) {}

  attach(bus: PinBus): void {
    this.bus = bus;
    bus.write(this.pin, 1, this.clock.now(), false);
  }

  pointer(pressed: boolean): void {
    this.pressed = pressed;
    this.bus?.write(this.pin, pressed ? 0 : 1, this.clock.now());
  }

  contains(x: number, y: number): boolean {
    return Math.hypot(x - this.at.x, y - this.at.y) < 23;
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#303744';
    ctx.fillRect(this.at.x - 24, this.at.y - 18, 48, 36);
    ctx.beginPath();
    ctx.arc(this.at.x, this.at.y + (this.pressed ? 3 : 0), 13, 0, Math.PI * 2);
    ctx.fillStyle = this.pressed ? '#f59e0b' : '#d7dce5';
    ctx.fill();
  }
}

export class Potentiometer implements SimDevice {
  readonly type = 'potentiometer';
  value = 32768;
  private bus?: PinBus;

  constructor(readonly id: string, readonly at: Point, private readonly pin: number, private readonly clock: Clock) {}

  attach(bus: PinBus): void {
    this.bus = bus;
    bus.write(this.pin, this.value, this.clock.now(), false);
  }

  setValue(value: number): void {
    this.value = Math.max(0, Math.min(65535, value));
    this.bus?.write(this.pin, this.value, this.clock.now());
  }

  render(ctx: CanvasRenderingContext2D): void {
    const angle = -Math.PI * 0.75 + (this.value / 65535) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.arc(this.at.x, this.at.y, 25, 0, Math.PI * 2);
    ctx.fillStyle = '#4b5563';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(this.at.x, this.at.y);
    ctx.lineTo(this.at.x + Math.cos(angle) * 19, this.at.y + Math.sin(angle) * 19);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

export class Servo implements SimDevice {
  readonly type = 'servo';
  private angle = 90;

  constructor(readonly id: string, readonly at: Point, private readonly pin: number) {}

  attach(bus: PinBus): void {
    bus.onChange(this.pin, (duty) => { this.angle = Math.max(0, Math.min(180, (duty * 100 - 2.5) * 24)); });
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(this.at.x - 27, this.at.y - 18, 54, 36);
    const radians = (this.angle - 90) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(this.at.x, this.at.y);
    ctx.lineTo(this.at.x + Math.sin(radians) * 38, this.at.y - Math.cos(radians) * 38);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 7;
    ctx.stroke();
  }
}

export class SK6812 implements SimDevice {
  readonly type = 'sk6812';
  readonly colors: string[];

  constructor(readonly id: string, readonly at: Point, readonly pin: number, count: number) {
    this.colors = new Array(count).fill('#111827');
  }

  attach(_bus: PinBus): void {}

  show(values: number[]): void {
    for (let i = 0; i < this.colors.length; i++) {
      const offset = i * 3;
      const [r, g, b] = values.slice(offset, offset + 3);
      if (r === undefined) break;
      this.colors[i] = `rgb(${[r, g, b].map((value) => Math.max(0, Math.min(255, value))).join(', ')})`;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.colors.forEach((color, index) => {
      ctx.beginPath();
      ctx.arc(this.at.x + index * 24, this.at.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = color === '#111827' ? 0 : 12;
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  }
}
