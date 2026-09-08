import { load } from 'js-yaml';
import { AHT25 } from '../devices/AHT25';
import { SSD1306 } from '../devices/SSD1306';
import { Button, Led, Potentiometer, Servo, SK6812 } from '../devices/SimpleDevices';
import type { Clock } from './Clock';
import { I2CBus } from './I2CBus';
import type { PinBus } from './PinBus';
import type { BoardConfig, PartConfig, SimDevice } from './types';
import { BOARD_HEIGHT, BOARD_WIDTH, GPIO_PINS } from './pins';

const VALID_PARTS = new Set(['led', 'button', 'potentiometer', 'ssd1306', 'sk6812', 'aht25', 'servo']);
export const TERMINALS: Record<PartConfig['type'], string[]> = {
  led: ['anode', 'cathode'], button: ['1', '2'], potentiometer: ['signal', 'vcc', 'gnd'],
  ssd1306: ['sda', 'scl', 'vcc', 'gnd'], sk6812: ['data', 'vcc', 'gnd'],
  aht25: ['sda', 'scl', 'vcc', 'gnd'], servo: ['signal', 'vcc', 'gnd'],
};
const POWER_TERMINALS: Partial<Record<PartConfig['type'], string[]>> = {
  led: ['cathode'], button: ['2'], potentiometer: ['vcc', 'gnd'], ssd1306: ['vcc', 'gnd'],
  sk6812: ['vcc', 'gnd'], aht25: ['vcc', 'gnd'], servo: ['vcc', 'gnd'],
};
const BUS_TERMINALS: Partial<Record<PartConfig['type'], string[]>> = { ssd1306: ['sda', 'scl'], aht25: ['sda', 'scl'] };

export interface LoadedBoard {
  config: BoardConfig;
  devices: SimDevice[];
  i2c: I2CBus;
  warnings: string[];
  i2cPins: Map<number, { sda: number; scl: number }>;
  pinFor(endpoint: string): number | undefined;
}

export const parseBoard = (source: string): BoardConfig => {
  const value = load(source) as Partial<BoardConfig> | null;
  if (!value || typeof value.board !== 'string' || !Array.isArray(value.parts) || !Array.isArray(value.connections)) {
    throw new TypeError('board.yml must contain board, parts, and connections');
  }
  if (!['pico', 'pico_w'].includes(value.board)) throw new TypeError('対応ボードは pico / pico_w です');
  const ids = new Set<string>();
  const validEndpoints = new Set<string>();
  for (const part of value.parts) {
    if (!part || typeof part.id !== 'string' || !/^[a-zA-Z][\w-]*$/.test(part.id) || ids.has(part.id) || !VALID_PARTS.has(part.type) ||
        !Array.isArray(part.at) || part.at.length !== 2 || !part.at.every(Number.isFinite)) {
      throw new TypeError(`Invalid or duplicate part in board.yml: ${JSON.stringify(part)}`);
    }
    if (part.at[0] < 0 || part.at[0] > BOARD_WIDTH || part.at[1] < 0 || part.at[1] > BOARD_HEIGHT) throw new RangeError('部品の配置がボードの表示範囲外です');
    if (part.count !== undefined && (!Number.isInteger(part.count) || part.count < 1 || part.count > 16)) throw new RangeError('LED 数は 1〜16 にしてください');
    if (part.address !== undefined && (!Number.isInteger(part.address) || part.address < 8 || part.address > 0x77)) throw new RangeError('I2C アドレスは 0x08〜0x77 にしてください');
    if (part.color !== undefined && !/^#[\da-f]{6}$/i.test(part.color)) throw new TypeError('LED の色は #rrggbb で指定してください');
    if (part.pulse_min !== undefined && (!Number.isFinite(part.pulse_min) || part.pulse_min <= 0)) throw new RangeError('サーボの最小パルス幅は正の数にしてください');
    if (part.pulse_max !== undefined && (!Number.isFinite(part.pulse_max) || part.pulse_max <= (part.pulse_min ?? 500))) throw new RangeError('サーボの最大パルス幅は最小値より大きくしてください');
    if ((part.pulse_min ?? 500) >= (part.pulse_max ?? 2500)) throw new RangeError('サーボのパルス幅の範囲が逆転しています');
    ids.add(part.id);
    TERMINALS[part.type as PartConfig['type']].forEach((terminal) => validEndpoints.add(`${part.id}.${terminal}`));
  }
  const connectedEndpoints = new Set<string>();
  for (const connection of value.connections) {
    if (!Array.isArray(connection) || connection.length !== 2 || !connection.every((item) => typeof item === 'string')) {
      throw new TypeError(`Invalid connection in board.yml: ${JSON.stringify(connection)}`);
    }
    const endpoints = connection.filter((item) => item.includes('.'));
    if (endpoints.length !== 1 || !validEndpoints.has(endpoints[0]) || connectedEndpoints.has(endpoints[0])) {
      throw new TypeError(`Invalid or duplicate part endpoint in board.yml: ${JSON.stringify(connection)}`);
    }
    connectedEndpoints.add(endpoints[0]);
    const target = connection.find((item) => item !== endpoints[0]);
    if (!target || !/^(?:gpio\d+|gnd|3v3)$/.test(target)) throw new TypeError(`Invalid connection target in board.yml: ${target}`);
    const gpio = /^gpio(\d+)$/.exec(target);
    if (gpio && !GPIO_PINS.includes(target)) throw new RangeError(`Pico の外部 GPIO は 0〜22、26〜28 です: ${target}`);
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
    return new Servo(part.id, at, requiredPin(`${part.id}.signal`), part.pulse_min, part.pulse_max);
  });
  devices.forEach((device) => device.attach(bus));
  const i2c = new I2CBus();
  const i2cPins = new Map<number, { sda: number; scl: number }>();
  devices.forEach((device) => {
    if (!(device instanceof SSD1306 || device instanceof AHT25)) return;
    i2c.register(device.address, device);
    const sda = pinFor(`${device.id}.sda`);
    const scl = pinFor(`${device.id}.scl`);
    if (sda !== undefined && scl !== undefined) i2cPins.set(device.address, { sda, scl });
  });
  return { config, devices, i2c, i2cPins, warnings: wiringWarnings(config), pinFor };
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
  config.parts.forEach((part) => BUS_TERMINALS[part.type]?.forEach((terminal) => {
    const endpoint = `${part.id}.${terminal}`;
    if (!targets.get(endpoint)?.some((target) => /^gpio\d+$/.test(target))) warnings.push(`${endpoint} が GPIO に接続されていません`);
  }));
  config.parts.filter(part => part.type === 'potentiometer').forEach(part => {
    if (!targets.get(`${part.id}.signal`)?.some(target => ['gpio26', 'gpio27', 'gpio28'].includes(target))) warnings.push(`${part.id}.signal は ADC 対応の GPIO26〜28 に接続してください`);
  });
  const gpioOwners = new Map<string, string[]>();
  config.connections.forEach(([a, b]) => {
    const gpio = /^gpio\d+$/.test(a) ? a : /^gpio\d+$/.test(b) ? b : undefined;
    const endpoint = a.includes('.') ? a : b.includes('.') ? b : undefined;
    if (!gpio || !endpoint) return;
    gpioOwners.set(gpio, [...(gpioOwners.get(gpio) ?? []), endpoint]);
  });
  gpioOwners.forEach((owners, gpio) => {
    const sharedBus = owners.every(endpoint => endpoint.endsWith('.sda')) || owners.every(endpoint => endpoint.endsWith('.scl'));
    if (owners.length > 1 && !sharedBus) warnings.push(`${gpio} が重複しています: ${owners.join(', ')}`);
  });
  return warnings;
};
