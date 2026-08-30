import { load } from 'js-yaml';
import { AHT25 } from '../devices/AHT25';
import { SSD1306 } from '../devices/SSD1306';
import { Button, Led, Potentiometer, Servo, SK6812 } from '../devices/SimpleDevices';
import type { Clock } from './Clock';
import { I2CBus } from './I2CBus';
import type { PinBus } from './PinBus';
import type { BoardConfig, PartConfig, SimDevice } from './types';

const VALID_PARTS = new Set(['led', 'button', 'potentiometer', 'ssd1306', 'sk6812', 'aht25', 'servo']);
const POWER_TERMINALS: Partial<Record<PartConfig['type'], string[]>> = {
  led: ['cathode'], button: ['2'], potentiometer: ['vcc', 'gnd'], ssd1306: ['vcc', 'gnd'],
  sk6812: ['vcc', 'gnd'], aht25: ['vcc', 'gnd'], servo: ['vcc', 'gnd'],
};

export interface LoadedBoard {
  config: BoardConfig;
  devices: SimDevice[];
  i2c: I2CBus;
  warnings: string[];
  pinFor(endpoint: string): number | undefined;
}

export const parseBoard = (source: string): BoardConfig => {
  const value = load(source) as Partial<BoardConfig> | null;
  if (!value || typeof value.board !== 'string' || !Array.isArray(value.parts) || !Array.isArray(value.connections)) {
    throw new TypeError('board.yml must contain board, parts, and connections');
  }
  const ids = new Set<string>();
  for (const part of value.parts) {
    if (!part || typeof part.id !== 'string' || ids.has(part.id) || !VALID_PARTS.has(part.type) ||
        !Array.isArray(part.at) || part.at.length !== 2 || !part.at.every(Number.isFinite)) {
      throw new TypeError(`Invalid or duplicate part in board.yml: ${JSON.stringify(part)}`);
    }
    ids.add(part.id);
  }
  for (const connection of value.connections) {
    if (!Array.isArray(connection) || connection.length !== 2 || !connection.every((item) => typeof item === 'string')) {
      throw new TypeError(`Invalid connection in board.yml: ${JSON.stringify(connection)}`);
    }
  }
  return value as BoardConfig;
};

export const loadBoard = (source: string, bus: PinBus, clock: Clock): LoadedBoard => {
  const config = parseBoard(source);
  const pinMap = new Map<string, number>();
  config.connections.forEach(([a, b]) => {
    const gpio = /^gpio(\d+)$/.exec(a) ?? /^gpio(\d+)$/.exec(b);
    const endpoint = a.includes('.') ? a : b.includes('.') ? b : undefined;
    if (gpio && endpoint) pinMap.set(endpoint, Number(gpio[1]));
  });
  const pinFor = (endpoint: string) => pinMap.get(endpoint);
  const requiredPin = (endpoint: string) => {
    const pin = pinFor(endpoint);
    if (pin === undefined) throw new TypeError(`${endpoint} is not connected to a GPIO pin`);
    return pin;
  };
  const devices = config.parts.map((part): SimDevice => {
    const at = { x: part.at[0], y: part.at[1] };
    if (part.type === 'led') return new Led(part.id, at, requiredPin(`${part.id}.anode`), part.color);
    if (part.type === 'button') return new Button(part.id, at, requiredPin(`${part.id}.1`), clock);
    if (part.type === 'potentiometer') return new Potentiometer(part.id, at, requiredPin(`${part.id}.signal`), clock);
    if (part.type === 'ssd1306') return new SSD1306(part.id, at, part.address);
    if (part.type === 'sk6812') return new SK6812(part.id, at, requiredPin(`${part.id}.data`), part.count ?? 1);
    if (part.type === 'aht25') return new AHT25(part.id, at, part.address);
    return new Servo(part.id, at, requiredPin(`${part.id}.signal`));
  });
  devices.forEach((device) => device.attach(bus));
  const i2c = new I2CBus();
  devices.forEach((device) => {
    if (device instanceof SSD1306 || device instanceof AHT25) i2c.register(device.address, device);
  });
  return { config, devices, i2c, warnings: wiringWarnings(config), pinFor };
};

export const wiringWarnings = (config: BoardConfig): string[] => {
  const targets = new Map<string, string[]>();
  config.connections.forEach(([a, b]) => {
    targets.set(a, [...(targets.get(a) ?? []), b]);
    targets.set(b, [...(targets.get(b) ?? []), a]);
  });
  const warnings: string[] = [];
  config.parts.forEach((part) => POWER_TERMINALS[part.type]?.forEach((terminal) => {
    const endpoint = `${part.id}.${terminal}`;
    const expected = terminal === 'gnd' || terminal === 'cathode' || terminal === '2' ? 'gnd' : '3v3';
    if (!targets.get(endpoint)?.includes(expected)) warnings.push(`${endpoint} が ${expected} に接続されていません`);
  }));
  const gpioOwners = new Map<string, string[]>();
  config.connections.forEach(([a, b]) => {
    const gpio = /^gpio\d+$/.test(a) ? a : /^gpio\d+$/.test(b) ? b : undefined;
    const endpoint = a.includes('.') ? a : b.includes('.') ? b : undefined;
    if (!gpio || !endpoint || /\.(sda|scl)$/.test(endpoint)) return;
    gpioOwners.set(gpio, [...(gpioOwners.get(gpio) ?? []), endpoint]);
  });
  gpioOwners.forEach((owners, gpio) => {
    if (owners.length > 1) warnings.push(`${gpio} が重複しています: ${owners.join(', ')}`);
  });
  return warnings;
};
