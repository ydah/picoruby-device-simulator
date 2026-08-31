import './style.css';
import { createEditor } from './editor';
import { BoardRenderer, WaveformRenderer } from './render';
import { PicoRubyRuntime } from './runtime';
import { PicoSimCore } from './sim/PicoSim';
import type { ClockMode } from './sim/Clock';
import { transferToR2P2, webSerialAvailable } from './transfer';

const DEFAULT_SOURCE = `require 'gpio'

led = GPIO.new(15, GPIO::OUT)

loop do
  led.write(1)
  puts "GPIO15 HIGH"
  sleep_ms 500
  led.write(0)
  puts "GPIO15 LOW"
  sleep_ms 500
end
`;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} was not found`);
  return element as T;
};

const encodeSource = (source: string) => {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
};
const decodeSource = (encoded: string) => new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
const sharedSource = (): string | undefined => {
  if (!location.hash.startsWith('#code=')) return undefined;
  try {
    return decodeSource(location.hash.slice(6));
  } catch {
    return undefined;
  }
};

const start = async (): Promise<void> => {
  const boardSource = byId<HTMLTextAreaElement>('board-source');
  let source = sharedSource() ?? localStorage.getItem('picosim.source') ?? DEFAULT_SOURCE;
  boardSource.value = await fetch('./board.yml').then((response) => {
    if (!response.ok) throw new Error('board.yml を読み込めませんでした');
    return response.text();
  });

  const core = new PicoSimCore();
  window.PicoSim = core;
  const consoleElement = byId<HTMLPreElement>('console');
  const status = byId<HTMLSpanElement>('runtime-status');
  const write = (text: string, error = false) => {
    const line = document.createElement('span');
    if (error) line.className = 'error';
    line.textContent = `${text}\n`;
    consoleElement.append(line);
    if (consoleElement.childElementCount > 2_000) consoleElement.firstElementChild?.remove();
    consoleElement.scrollTop = consoleElement.scrollHeight;
  };
  const runtime = new PicoRubyRuntime(core, write);
  const editor = createEditor(byId('editor'), source, (next) => {
    source = next;
    try { localStorage.setItem('picosim.source', next); } catch { /* The editor still works when storage is unavailable. */ }
  });
  const configure = () => {
    try {
      const board = core.configure(boardSource.value);
      byId('board-name').textContent = board.config.board;
      byId('warnings').replaceChildren(...board.warnings.map((warning) => {
        const item = document.createElement('p');
        item.textContent = `警告: ${warning}`;
        return item;
      }));
      buildControls(core);
      status.textContent = board.warnings.length ? `配線警告 ${board.warnings.length} 件` : '準備完了';
      status.className = 'status';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.className = 'status error';
    }
  };
  configure();
  void runtime.prepare().then(() => {
    if (status.textContent === '準備完了') status.textContent = 'PicoRuby 準備完了';
  }).catch((error) => {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.className = 'status error';
  });
  new BoardRenderer(byId<HTMLCanvasElement>('board'), core);
  new WaveformRenderer(byId<HTMLCanvasElement>('waveform'), core, byId('waveform-summary'));

  const run = byId<HTMLButtonElement>('run');
  run.addEventListener('click', async () => {
    run.disabled = true;
    status.textContent = 'PicoRuby を起動中…';
    status.className = 'status running';
    try {
      if (!await runtime.run(source)) return;
      status.textContent = core.clock.mode === 'step' ? 'ステップ待機中' : '実行中';
    } catch (error) {
      write(error instanceof Error ? error.stack ?? error.message : String(error), true);
      status.textContent = '実行エラー';
      status.className = 'status error';
    } finally {
      run.disabled = false;
    }
  });
  byId('stop').addEventListener('click', () => {
    runtime.stop();
    status.textContent = '停止しました';
    status.className = 'status';
  });
  const speed = byId<HTMLSelectElement>('speed');
  speed.addEventListener('change', () => {
    const wasStep = core.clock.mode === 'step';
    core.clock.mode = speed.value as ClockMode;
    byId<HTMLButtonElement>('step').disabled = core.clock.mode !== 'step';
    if (core.clock.mode === 'step') runtime.pause();
    else if (wasStep) runtime.resume();
  });
  byId('step').addEventListener('click', () => runtime.step());
  byId('apply-board').addEventListener('click', () => { runtime.stop(); configure(); });
  byId('clear-console').addEventListener('click', () => { consoleElement.textContent = ''; });
  byId('share').addEventListener('click', async () => {
    try {
      const url = new URL(location.href);
      url.hash = `code=${encodeSource(source)}`;
      await navigator.clipboard.writeText(url.href);
      status.textContent = '共有 URL をコピーしました';
    } catch {
      status.textContent = '共有 URL をコピーできませんでした';
      status.className = 'status error';
    }
  });
  const flash = byId<HTMLButtonElement>('flash');
  if (!webSerialAvailable()) {
    flash.disabled = true;
    flash.title = 'Web Serial は Chrome / Edge で利用できます';
  }
  flash.addEventListener('click', async () => {
    flash.disabled = true;
    status.textContent = '転送先を選択してください';
    try {
      await transferToR2P2(source);
      status.textContent = 'main.rb を転送して実行しました';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.className = 'status error';
    } finally {
      flash.disabled = false;
    }
  });

  editor.focus();
};

const buildControls = (core: PicoSimCore): void => {
  const controls = byId('device-controls');
  controls.replaceChildren();
  core.buttons().forEach((button) => {
    const control = document.createElement('button');
    control.textContent = `${button.id} を押す`;
    const press = () => button.pointer(true);
    const release = () => button.pointer(false);
    control.addEventListener('pointerdown', press);
    control.addEventListener('pointerup', release);
    control.addEventListener('pointercancel', release);
    control.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') press();
    });
    control.addEventListener('keyup', release);
    controls.append(control);
  });
  core.potentiometers().forEach((pot) => controls.append(labeledInput(`${pot.id} ADC`, 'range', String(pot.value), '0', '65535', (value) => pot.setValue(Number(value)))));
  core.sensors().forEach((sensor) => {
    controls.append(labeledInput(`${sensor.id} 温度 °C`, 'number', String(sensor.temperature), '-50', '150', (value) => { sensor.temperature = Number(value); }));
    controls.append(labeledInput(`${sensor.id} 湿度 %`, 'number', String(sensor.humidity), '0', '100', (value) => { sensor.humidity = Number(value); }));
  });
};

const labeledInput = (text: string, type: string, value: string, min: string, max: string, change: (value: string) => void): HTMLLabelElement => {
  const label = document.createElement('label');
  label.append(text);
  const input = document.createElement('input');
  Object.assign(input, { type, value, min, max });
  input.addEventListener('input', () => change(input.value));
  label.append(input);
  return label;
};

void start().catch((error) => {
  byId('runtime-status').textContent = error instanceof Error ? error.message : String(error);
});
