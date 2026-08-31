import createModule from '@picoruby/wasm-wasi/picoruby.js';
import wasmUrl from '@picoruby/wasm-wasi/picoruby.wasm?url';
import simhal from './simhal.rb?raw';
import type { PicoSimCore } from './sim/PicoSim';

const TICK_MS = 4;

export class PicoRubyRuntime {
  private module?: PicoRubyModule;
  private prepared?: Promise<PicoRubyModule>;
  private generation = 0;
  private lastFrame = 0;
  private tickRemainder = 0;
  private outputVersion = 0;

  constructor(private readonly core: PicoSimCore, private readonly output: (text: string, error?: boolean) => void) {}

  async prepare(): Promise<void> {
    this.prepared ??= this.createModule().catch((error: unknown) => {
      this.prepared = undefined;
      throw error;
    });
    await this.prepared;
  }

  async run(source: string): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    this.core.prepareRun();
    const module = await (this.prepared ?? this.createModule());
    if (generation !== this.generation) return false;
    this.prepared = undefined;
    const result = module.ccall('picorb_create_task_with_filename', 'number', ['string', 'string'], [`${simhal}\n${source}`, 'main.rb']);
    if (result !== 0) throw new Error('PicoRuby could not create the task');
    this.module = module;
    this.lastFrame = performance.now();
    this.tickRemainder = 0;
    if (this.core.clock.mode === 'step') this.runUntilIdle();
    else this.pump(generation);
    return true;
  }

  stop(): void {
    this.generation++;
    this.module = undefined;
  }

  pause(): void {
    this.generation++;
  }

  resume(): void {
    if (!this.module || this.core.clock.mode === 'step') return;
    const generation = ++this.generation;
    this.lastFrame = performance.now();
    this.pump(generation);
  }

  step(): void {
    if (!this.module || this.core.clock.mode !== 'step') return;
    const start = this.core.bus.history.length + this.outputVersion;
    for (let ticks = 0; ticks < 2500; ticks++) {
      this.tick();
      this.runUntilIdle();
      if (this.core.bus.history.length + this.outputVersion > start) break;
    }
  }

  private pump(generation: number): void {
    if (!this.module || generation !== this.generation || this.core.clock.mode === 'step') return;
    const now = performance.now();
    this.tickRemainder += (now - this.lastFrame) * this.core.clock.speed;
    this.lastFrame = now;
    const ticks = Math.min(250, Math.floor(this.tickRemainder / TICK_MS));
    for (let index = 0; index < ticks; index++) this.tick();
    this.tickRemainder -= ticks * TICK_MS;
    this.runUntilIdle();
    window.setTimeout(() => this.pump(generation), 4);
  }

  private tick(): void {
    this.module?._mrb_tick_wasm();
    this.core.clock.advance(TICK_MS);
  }

  private runUntilIdle(): void {
    if (!this.module) return;
    const status = this.module._mrb_run_step_status ?? (() => this.module!._mrb_run_step() < 0 ? -1 : 1);
    const deadline = performance.now() + 12;
    while (performance.now() < deadline && status() > 0) {}
  }

  private write(text: string, error = false): void {
    this.outputVersion++;
    this.output(text, error);
  }

  private async createModule(): Promise<PicoRubyModule> {
    const module = await createModule({
      locateFile: (path: string) => path.endsWith('.wasm') ? wasmUrl : path,
      print: (text: string) => this.write(text),
      printErr: (text: string) => this.write(text, true),
    });
    module.ccall('picorb_init', 'number', [], []);
    return module;
  }
}
