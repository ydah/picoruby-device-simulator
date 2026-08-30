import { Button } from './devices/SimpleDevices';
import type { PicoSimCore } from './sim/PicoSim';

const pinPosition = (pin: number): [number, number] => pin < 20
  ? [282, 42 + pin * 13]
  : [358, 42 + (39 - pin) * 13];

export class BoardRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly core: PicoSimCore) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    canvas.addEventListener('pointerdown', (event) => this.pointer(event, true));
    window.addEventListener('pointerup', (event) => this.pointer(event, false));
    const frame = () => { this.render(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }

  private render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.wires();
    ctx.fillStyle = '#146b65';
    ctx.roundRect(280, 22, 80, 286, 9);
    ctx.fill();
    ctx.fillStyle = '#dbeafe';
    ctx.font = '700 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('PICO W', 320, 170);
    for (let pin = 0; pin < 40; pin++) {
      const [x, y] = pinPosition(pin);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f8d56b';
      ctx.fill();
    }
    this.core.board?.devices.forEach((device) => {
      device.render(ctx);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(device.id, device.at.x, device.at.y + (device.type === 'ssd1306' ? 78 : 43));
    });
  }

  private wires(): void {
    const board = this.core.board;
    if (!board) return;
    const colors = ['#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#fb7185'];
    board.config.connections.forEach(([a, b], index) => {
      const gpioText = /^gpio(\d+)$/.exec(a) ?? /^gpio(\d+)$/.exec(b);
      const endpoint = a.includes('.') ? a : b.includes('.') ? b : undefined;
      if (!gpioText || !endpoint) return;
      const device = board.devices.find(({ id }) => endpoint.startsWith(`${id}.`));
      if (!device) return;
      const [px, py] = pinPosition(Number(gpioText[1]));
      this.ctx.beginPath();
      this.ctx.moveTo(px, py);
      this.ctx.bezierCurveTo((px + device.at.x) / 2, py, (px + device.at.x) / 2, device.at.y, device.at.x, device.at.y);
      this.ctx.strokeStyle = colors[index % colors.length];
      this.ctx.globalAlpha = 0.62;
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    });
  }

  private pointer(event: PointerEvent, pressed: boolean): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * this.canvas.width / rect.width;
    const y = (event.clientY - rect.top) * this.canvas.height / rect.height;
    this.core.board?.devices.forEach((device) => {
      if (device instanceof Button && (!pressed || device.contains(x, y))) device.pointer(pressed);
    });
  }
}

export class WaveformRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly core: PicoSimCore, private readonly summary: HTMLElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    const frame = () => { this.render(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }

  private render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const events = this.core.bus.history;
    const pins = [...new Set(events.map(({ pin }) => pin))].slice(-6);
    const end = Math.max(5000, this.core.clock.now());
    const start = end - 5000;
    ctx.font = '11px monospace';
    ctx.lineWidth = 2;
    pins.forEach((pin, row) => {
      const y = 24 + row * 27;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`GP${pin}`, 8, y + 5);
      ctx.beginPath();
      let value = 0;
      let x = 48;
      ctx.moveTo(x, y + 8);
      events.filter((event) => event.pin === pin).forEach((event) => {
        if (event.t < start) { value = event.v; return; }
        const nextX = 48 + (event.t - start) / 5000 * (this.canvas.width - 60);
        ctx.lineTo(nextX, y + (value ? -7 : 8));
        value = event.v;
        ctx.lineTo(nextX, y + (value ? -7 : 8));
        x = nextX;
      });
      ctx.lineTo(Math.max(x, this.canvas.width - 12), y + (value ? -7 : 8));
      ctx.strokeStyle = '#5eead4';
      ctx.stroke();
    });
    if (!pins.length) {
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.fillText('実行するとピンの変化が表示されます', this.canvas.width / 2, 90);
      ctx.textAlign = 'left';
    }
    this.summary.textContent = pins.map((pin) => `GPIO ${pin}: ${this.core.bus.read(pin)}`).join('、');
  }
}
