/// <reference types="vite/client" />

declare module '@picoruby/wasm-wasi/picoruby.js' {
  const createModule: (options?: Record<string, unknown>) => Promise<PicoRubyModule>;
  export default createModule;
}

interface PicoRubyModule {
  ccall(name: string, returnType: string, argTypes: string[], args: unknown[]): number;
  _mrb_tick_wasm(): void;
  _mrb_run_step(): number;
  _mrb_run_step_status?: () => number;
  _mrb_gc_scheduler_pending_wasm?: () => number;
}
