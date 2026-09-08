import type { PinBus } from './PinBus';

export interface Point {
  x: number;
  y: number;
}

export interface SimDevice {
  readonly id: string;
  readonly type: string;
  readonly at: Point;
  attach(bus: PinBus): void;
  render(ctx: CanvasRenderingContext2D): void;
  pointer?(pressed: boolean): void;
  contains?(x: number, y: number): boolean;
}

export interface PartConfig {
  id: string;
  type: 'led' | 'button' | 'potentiometer' | 'ssd1306' | 'sk6812' | 'aht25' | 'servo';
  at: [number, number];
  color?: string;
  address?: number;
  count?: number;
  pulse_min?: number;
  pulse_max?: number;
}

export interface BoardConfig {
  board: string;
  parts: PartConfig[];
  connections: [string, string][];
}
