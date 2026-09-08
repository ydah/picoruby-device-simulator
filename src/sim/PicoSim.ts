import { AHT25 } from '../devices/AHT25';
import { SSD1306 } from '../devices/SSD1306';
import { Button, Potentiometer, Servo, SK6812 } from '../devices/SimpleDevices';
import { Clock } from './Clock';
import { loadBoard, type LoadedBoard } from './board';
import { PinBus } from './PinBus';
import { SPIBus } from './SPIBus';

export class PicoSimCore {
  bus = new PinBus();
  readonly clock = new Clock();
  readonly spi = new SPIBus();
  board?: LoadedBoard;
  onChange: () => void = () => undefined;
  eventVersion = 0;
  private readonly i2cHandles = new Map<number, { sda: number; scl: number }>();
  private nextI2CHandle = 0;

  configure(source: string): LoadedBoard {
    const bus = new PinBus();
    const board = loadBoard(source, bus, this.clock);
    this.bus = bus;
    this.board = board;
    this.clock.reset();
    this.bus.clearHistory();
    this.i2cHandles.clear();
    this.nextI2CHandle = 0;
    this.onChange();
    return board;
  }

  prepareRun(): void {
    this.clock.reset();
    this.bus.resetOutputs();
    this.potentiometers().forEach(pot => {
      const pin = this.board?.pinFor(`${pot.id}.signal`);
      if (pin !== undefined) this.bus.setMode(pin, 'adc');
    });
    this.i2cHandles.clear();
    this.nextI2CHandle = 0;
    this.board?.devices.forEach(device => {
      if (device instanceof SSD1306) device.clear();
      if (device instanceof SK6812) device.colors.fill('#111827');
    });
  }

  pinMode(pin: number, flags: number, pull = 0): void {
    this.bus.setMode(pin, flags & 2 ? 'out' : 'in', pull || flags & 24);
  }

  digitalWrite(pin: number, value: number): number {
    if (value !== 0 && value !== 1) throw new TypeError('GPIO value must be 0 or 1');
    this.bus.write(pin, value, this.clock.now());
    this.onChange();
    return 0;
  }

  digitalRead(pin: number): number {
    return this.bus.read(pin);
  }

  pwmOpen(pin: number, frequency: number, duty: number): void {
    this.bus.setMode(pin, 'pwm');
    this.pwmWrite(pin, frequency, duty);
  }

  pwmWrite(pin: number, _frequency: number, duty: number): number {
    if (!Number.isFinite(_frequency) || _frequency < 0 || !Number.isFinite(duty)) throw new RangeError('PWM frequency and duty must be finite, with non-negative frequency');
    const frequencyChanged = this.bus.pwmFrequency.get(pin) !== _frequency;
    if (frequencyChanged) this.bus.version++;
    this.bus.pwmFrequency.set(pin, _frequency);
    const value = _frequency > 0 ? Math.max(0, Math.min(100, duty)) / 100 : 0;
    this.bus.write(pin, value, this.clock.now());
    if (frequencyChanged) this.bus.notify(pin);
    this.onChange();
    return duty;
  }

  adcRead(pin: number): number {
    if (![26, 27, 28].includes(pin)) throw new RangeError('ADC は GPIO26〜28 に接続してください');
    this.bus.setMode(pin, 'adc');
    return Math.round(this.bus.read(pin));
  }

  i2cOpen(sda: number, scl: number, _frequency: number): number {
    const handle = this.nextI2CHandle++;
    this.i2cHandles.set(handle, { sda, scl });
    return handle;
  }

  i2cWrite(bus: number, address: number, data: number[]): number {
    if (!this.i2cConnected(bus, address)) return -1;
    const result = this.board?.i2c.write(address, Uint8Array.from(data)) ?? -1;
    this.refresh();
    return result;
  }

  i2cRead(bus: number, address: number, length: number): number[] {
    if (!this.i2cConnected(bus, address)) return [];
    this.eventVersion++;
    return [...(this.board?.i2c.read(address, length) ?? new Uint8Array())];
  }

  spiTransfer(chipSelectPin: number, data: number[]): number[] {
    this.eventVersion++;
    return [...this.spi.transfer(chipSelectPin, Uint8Array.from(data))];
  }

  sk6812Show(pin: number, colors: number[]): void {
    const strip = this.board?.devices.find((device) => device instanceof SK6812 && device.pin === pin);
    if (strip instanceof SK6812) strip.show(colors);
    this.refresh();
  }

  oledClear(address: number, pattern = 0): void {
    const oled = this.device(SSD1306, address);
    pattern ? oled?.fill(pattern) : oled?.clear();
    this.refresh();
  }

  oledPixel(address: number, x: number, y: number, value: number): void {
    this.device(SSD1306, address)?.pixel(x, y, value);
    this.refresh();
  }

  oledText(address: number, x: number, y: number, text: string, scale: number): void {
    this.device(SSD1306, address)?.text(x, y, text, scale);
    this.refresh();
  }

  potentiometers(): Potentiometer[] {
    return this.board?.devices.filter((device): device is Potentiometer => device instanceof Potentiometer) ?? [];
  }

  buttons(): Button[] {
    return this.board?.devices.filter((device): device is Button => device instanceof Button) ?? [];
  }

  sensors(): AHT25[] {
    return this.board?.devices.filter((device): device is AHT25 => device instanceof AHT25) ?? [];
  }

  servos(): Servo[] {
    return this.board?.devices.filter((device): device is Servo => device instanceof Servo) ?? [];
  }

  refresh(): void {
    this.eventVersion++;
    this.onChange();
  }

  private device<T extends SSD1306 | AHT25>(kind: new (...args: never[]) => T, address: number): T | undefined {
    return this.board?.devices.find((device): device is T => device instanceof kind && device.address === address);
  }

  private i2cConnected(bus: number, address: number): boolean {
    const opened = this.i2cHandles.get(bus);
    const wired = this.board?.i2cPins.get(address);
    if (!opened || !wired) return false;
    return (opened.sda < 0 || opened.sda === wired.sda) && (opened.scl < 0 || opened.scl === wired.scl);
  }
}

declare global {
  interface Window { PicoSim: PicoSimCore }
}
