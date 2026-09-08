import { Button } from './devices/SimpleDevices';
import { PICO_HEADERS, headerPosition, pinPosition } from './sim/pins';
import type { PinEvent } from './sim/PinBus';
import type { PicoSimCore } from './sim/PicoSim';
import type { SimDevice } from './sim/types';

export class BoardRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private moving?: { device: SimDevice; x: number; y: number };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly core: PicoSimCore, private readonly onMove: (id: string, x: number, y: number) => boolean = () => true) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      if (document.querySelector<HTMLInputElement>('#move-parts')?.checked) {
        const [x, y] = this.coordinates(event);
        const device = [...(core.board?.devices ?? [])].reverse().find(device => Math.abs(x - device.at.x) < (device.type === 'ssd1306' ? 137 : device.type === 'sk6812' ? 96 : 40) && Math.abs(y - device.at.y) < (device.type === 'ssd1306' ? 73 : 35));
        if (device) this.moving = { device, ...device.at };
        return;
      }
      this.pointer(event, true);
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.moving) return;
      const [x, y] = this.coordinates(event);
      const { device } = this.moving;
      const margin = device.type === 'ssd1306' ? 140 : 40;
      device.at.x = Math.round(Math.max(margin, Math.min(canvas.width - margin, x)));
      device.at.y = Math.round(Math.max(80, Math.min(canvas.height - 100, y)));
    });
    const release = () => {
      if (this.moving) {
        const { device, x, y } = this.moving;
        this.moving = undefined;
        if (!this.onMove(device.id, device.at.x, device.at.y)) Object.assign(device.at, { x, y });
      }
      this.core.buttons().forEach(button => button.pointer(false));
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    window.addEventListener('blur', release);
    const frame = () => { this.render(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }

  private render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.wires();
    ctx.beginPath();
    ctx.roundRect(358, 65, 84, 330, 9);
    ctx.fillStyle = '#146b65';
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(382, 54, 36, 25);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(382, 212, 36, 36);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(this.core.board?.config.board === 'pico' ? 'PICO' : 'PICO W', 400, 192);
    PICO_HEADERS.forEach((pins, side) => pins.forEach((pin, row) => {
      const [x, y] = headerPosition(side, row);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = pin.includes('gnd') ? '#94a3b8' : pin.startsWith('gpio') ? '#fde68a' : '#fda4af';
      ctx.fill();
      ctx.font = '11px system-ui';
      ctx.textAlign = side ? 'left' : 'right';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(pin.replace('gpio', 'GP').toUpperCase(), x + (side ? 10 : -10), y + 4);
    }));
    this.core.board?.devices.forEach(device => {
      ctx.save();
      ctx.beginPath();
      device.render(ctx);
      ctx.restore();
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(device.id, device.at.x, device.at.y + (device.type === 'ssd1306' ? 90 : 48));
    });
  }

  private wires(): void {
    const board = this.core.board;
    if (!board) return;
    const colors = ['#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#fb7185'];
    board.config.connections.forEach(([a, b], index) => {
      const endpoint = a.includes('.') ? a : b;
      const target = a.includes('.') ? b : a;
      const position = pinPosition(target);
      const device = board.devices.find(({ id }) => endpoint.startsWith(`${id}.`));
      if (!position || !device) return;
      const [px, py] = position;
      const middle = (px + device.at.x) / 2;
      this.ctx.beginPath();
      this.ctx.moveTo(px, py);
      this.ctx.bezierCurveTo(middle, py, middle, device.at.y, device.at.x, device.at.y);
      this.ctx.strokeStyle = target === 'gnd' ? '#64748b' : target === '3v3' ? '#fda4af' : colors[index % colors.length];
      this.ctx.globalAlpha = target.startsWith('gpio') ? 0.8 : 0.4;
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    });
  }

  private coordinates(event: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * this.canvas.width / rect.width, (event.clientY - rect.top) * this.canvas.height / rect.height];
  }

  private pointer(event: PointerEvent, pressed: boolean): void {
    const [x, y] = this.coordinates(event);
    this.core.board?.devices.forEach(device => {
      if (device instanceof Button && device.contains(x, y)) device.pointer(pressed);
    });
  }
}

export const waveformPoints = (events: PinEvent[], initial: number, start: number, end: number): { t: number; v: number }[] => {
  let value = initial;
  for (const event of events) if (event.t < start) value = event.v;
  const points = [{ t: start, v: value }];
  for (const event of events) {
    if (event.t < start || event.t > end) continue;
    points.push({ t: event.t, v: value }, { t: event.t, v: event.v });
    value = event.v;
  }
  points.push({ t: end, v: value });
  return points;
};

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
    const selection = document.querySelector<HTMLSelectElement>('#trace-pin')?.value ?? 'all';
    const connected = this.core.board?.config.connections.flat().filter(pin => pin.startsWith('gpio')).map(pin => Number(pin.slice(4))) ?? [];
    const pins = selection === 'all' ? [...new Set([...events.map(({ pin }) => pin).reverse(), ...connected])].slice(0, 6) : [Number(selection)];
    const end = Math.max(5000, this.core.clock.now());
    const start = end - 5000;
    ctx.font = '11px monospace';
    ctx.lineWidth = 1.5;
    for (let second = 0; second <= 5; second++) {
      const x = 52 + second / 5 * (this.canvas.width - 72);
      ctx.strokeStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 170);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText(`${((start + second * 1000) / 1000).toFixed(1)}s`, x, 186);
    }
    ctx.textAlign = 'left';
    pins.forEach((pin, row) => {
      const y = 16 + row * 26;
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(`GP${pin}`, 4, y + 5);
      const analog = this.core.bus.mode(pin) === 'adc';
      const points = waveformPoints(events.filter(event => event.pin === pin), this.core.bus.initialValue(pin), start, end);
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = 52 + (point.t - start) / 5000 * (this.canvas.width - 72);
        const level = Math.max(0, Math.min(1, analog ? point.v / 65535 : point.v));
        const py = y + 10 - level * 18;
        if (index === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      });
      ctx.strokeStyle = '#5eead4';
      ctx.stroke();
    });
    const readings = pins.map(pin => {
      const value = this.core.bus.read(pin);
      const mode = this.core.bus.mode(pin);
      const text = mode === 'pwm' ? `${(value * 100).toFixed(1)}% / ${this.core.bus.pwmFrequency.get(pin) ?? 0} Hz`
        : mode === 'adc' ? `${value.toFixed(0)} / ${(value / 65535 * 3.3).toFixed(2)} V` : value ? 'HIGH' : 'LOW';
      return `GP${pin}: ${text}`;
    }).join('、');
    if (this.summary.textContent !== readings) this.summary.textContent = readings;
    const time = document.querySelector('#sim-time');
    if (time) time.textContent = `${(this.core.clock.now() / 1000).toFixed(2)} s`;
  }
}
