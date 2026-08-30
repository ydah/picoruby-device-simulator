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

const encodeSource = (source: string) => btoa(String.fromCharCode(...new TextEncoder().encode(source)));
const decodeSource = (encoded: string) => new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));

const start = async (): Promise<void> => {
  const boardSource = byId<HTMLTextAreaElement>('board-source');
  const sourceFromUrl = location.hash.startsWith('#code=') ? decodeSource(location.hash.slice(6)) : undefined;
  let source = sourceFromUrl ?? localStorage.getItem('picosim.source') ?? DEFAULT_SOURCE;
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
    consoleElement.scrollTop = consoleElement.scrollHeight;
  };
  const runtime = new PicoRubyRuntime(core, write);
  const editor = createEditor(byId('editor'), source, (next) => {
    source = next;
    localStorage.setItem('picosim.source', next);
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
  new BoardRenderer(byId<HTMLCanvasElement>('board'), core);
  new WaveformRenderer(byId<HTMLCanvasElement>('waveform'), core, byId('waveform-summary'));

  byId('run').addEventListener('click', async () => {
    status.textContent = 'PicoRuby を起動中…';
    status.className = 'status running';
    try {
      configure();
      await runtime.run(source);
      status.textContent = core.clock.mode === 'step' ? 'ステップ待機中' : '実行中';
    } catch (error) {
      write(error instanceof Error ? error.stack ?? error.message : String(error), true);
      status.textContent = '実行エラー';
      status.className = 'status error';
    }
  });
  byId('stop').addEventListener('click', () => {
    runtime.stop();
    status.textContent = '停止しました';
    status.className = 'status';
  });
  const speed = byId<HTMLSelectElement>('speed');
  speed.addEventListener('change', () => {
    core.clock.mode = speed.value as ClockMode;
    byId<HTMLButtonElement>('step').disabled = core.clock.mode !== 'step';
  });
  byId('step').addEventListener('click', () => runtime.step());
  byId('apply-board').addEventListener('click', configure);
  byId('clear-console').addEventListener('click', () => { consoleElement.textContent = ''; });
  byId('share').addEventListener('click', async () => {
    const url = new URL(location.href);
    url.hash = `code=${encodeSource(source)}`;
    await navigator.clipboard.writeText(url.href);
    status.textContent = '共有 URL をコピーしました';
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
