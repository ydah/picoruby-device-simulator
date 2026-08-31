import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PicoSimCore } from './sim/PicoSim';

const createModule = vi.hoisted(() => vi.fn());
vi.mock('../vendor/picoruby-wasm-sim/picoruby.mjs', () => ({ default: createModule }));
vi.mock('../vendor/picoruby-wasm-sim/picoruby.wasm?url', () => ({ default: 'picoruby.wasm' }));
vi.mock('./simhal.rb?raw', () => ({ default: '# simhal' }));

import { PicoRubyRuntime } from './runtime';

const moduleStub = (): PicoRubyModule => ({
  ccall: vi.fn(() => 0),
  _mrb_tick_wasm: vi.fn(),
  _mrb_run_step: vi.fn(() => 0),
  _mrb_run_step_status: vi.fn(() => 0),
});

describe('PicoRubyRuntime lifecycle', () => {
  beforeEach(() => {
    createModule.mockReset();
    vi.useRealTimers();
  });

  it('does not start after stop wins a loading race', async () => {
    let finish!: (module: PicoRubyModule) => void;
    createModule.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const module = moduleStub();
    const core = new PicoSimCore();
    core.clock.mode = 'step';
    const runtime = new PicoRubyRuntime(core, vi.fn());

    const running = runtime.run('puts :late');
    runtime.stop();
    finish(module);

    expect(await running).toBe(false);
    expect(module.ccall).toHaveBeenCalledTimes(1);
    expect(module.ccall).toHaveBeenCalledWith('picorb_init', 'number', [], []);
  });

  it('lets only the latest run use a prepared VM', async () => {
    const module = moduleStub();
    createModule.mockResolvedValue(module);
    const core = new PicoSimCore();
    core.clock.mode = 'step';
    const runtime = new PicoRubyRuntime(core, vi.fn());
    await runtime.prepare();

    const first = runtime.run('puts :first');
    const second = runtime.run('puts :second');

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(module.ccall).toHaveBeenCalledTimes(2);
    expect(module.ccall).toHaveBeenLastCalledWith(
      'picorb_create_task_with_filename',
      'number',
      ['string', 'string'],
      [expect.stringContaining('puts :second'), 'main.rb'],
    );
  });

  it('does not retain a VM when task creation fails', async () => {
    const module = moduleStub();
    vi.mocked(module.ccall).mockReturnValueOnce(0).mockReturnValueOnce(1);
    createModule.mockResolvedValue(module);
    const runtime = new PicoRubyRuntime(new PicoSimCore(), vi.fn());

    await expect(runtime.run('invalid')).rejects.toThrow('could not create');
    expect((runtime as unknown as { module?: PicoRubyModule }).module).toBeUndefined();
  });

  it('steps past long sleeps until the next observable event', async () => {
    vi.useFakeTimers();
    const module = moduleStub();
    const core = new PicoSimCore();
    core.clock.mode = 'step';
    vi.mocked(module._mrb_tick_wasm).mockImplementation(() => {
      if (core.clock.now() >= 20_000) core.bus.write(25, 1, core.clock.now());
    });
    createModule.mockResolvedValue(module);
    const runtime = new PicoRubyRuntime(core, vi.fn());
    await runtime.run('sleep_ms 20000; GPIO.new(25, GPIO::OUT).write(1)');

    runtime.step();
    await vi.runAllTimersAsync();

    expect(core.bus.history.at(-1)).toMatchObject({ pin: 25, v: 1 });
    expect(core.clock.now()).toBeGreaterThanOrEqual(20_000);
  });
});
