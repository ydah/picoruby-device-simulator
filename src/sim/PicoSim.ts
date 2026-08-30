import { AHT25 } from '../devices/AHT25';
import { SSD1306 } from '../devices/SSD1306';
import { Button, Potentiometer, Servo, SK6812 } from '../devices/SimpleDevices';
import { Clock } from './Clock';
import { loadBoard, type LoadedBoard } from './board';
import { PinBus } from './PinBus';
import { SPIBus } from './SPIBus';

export class PicoSimCore {
  readonly bus = new PinBus();
  readonly clock = new Clock();
  readonly spi = new SPIBus();
  board?: LoadedBoard;
  onChange: () => void = () => undefined;

  configure(source: string): LoadedBoard {
    this.bus.reset();
    this.board = loadBoard(source, this.bus, this.clock);
    this.onChange();
    return this.board;
  }

  prepareRun(): void {
    this.clock.reset();
    this.bus.clearHistory();
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
    const value = _frequency > 0 ? Math.max(0, Math.min(100, duty)) / 100 : 0;
    this.bus.write(pin, value, this.clock.now());
    this.onChange();
    return duty;
  }

  adcRead(pin: number): number {
    return Math.round(this.bus.read(pin));
  }

  i2cOpen(_sda: number, _scl: number, _frequency: number): number {
    return 0;
  }

  i2cWrite(_bus: number, address: number, data: number[]): number {
    const result = this.board?.i2c.write(address, Uint8Array.from(data)) ?? -1;
    this.onChange();
    return result;
  }

  i2cRead(_bus: number, address: number, length: number): number[] {
    return [...(this.board?.i2c.read(address, length) ?? new Uint8Array())];
  }

  spiTransfer(chipSelectPin: number, data: number[]): number[] {
    return [...this.spi.transfer(chipSelectPin, Uint8Array.from(data))];
  }

  sk6812Show(pin: number, colors: number[]): void {
    const strip = this.board?.devices.find((device) => device instanceof SK6812 && device.pin === pin);
    if (strip instanceof SK6812) strip.show(colors);
    this.onChange();
  }

  oledClear(address: number, pattern = 0): void {
    const oled = this.device(SSD1306, address);
    pattern ? oled?.fill(pattern) : oled?.clear();
    this.onChange();
  }

  oledPixel(address: number, x: number, y: number, value: number): void {
    this.device(SSD1306, address)?.pixel(x, y, value);
  }

  oledText(address: number, x: number, y: number, text: string, scale: number): void {
    this.device(SSD1306, address)?.text(x, y, text, scale);
    this.onChange();
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
    this.onChange();
  }

  private device<T extends SSD1306 | AHT25>(kind: new (...args: never[]) => T, address: number): T | undefined {
    return this.board?.devices.find((device): device is T => device instanceof kind && device.address === address);
  }
}

declare global {
  interface Window { PicoSim: PicoSimCore }
}
