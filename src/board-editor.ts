import { dump } from 'js-yaml';
import { parseBoard, TERMINALS } from './sim/board';
import { BOARD_HEIGHT, BOARD_WIDTH, GPIO_PINS } from './sim/pins';
import type { BoardConfig, PartConfig } from './sim/types';

export const PART_NAMES: Record<PartConfig['type'], string> = {
  led: 'LED', button: '押しボタン', potentiometer: '可変抵抗', ssd1306: 'OLED ディスプレイ',
  sk6812: 'RGB LED', aht25: '温湿度センサー', servo: 'サーボ',
};

export const addPart = (config: BoardConfig, type: PartConfig['type']): string => {
  let number = 1;
  while (config.parts.some(part => part.id === `${type}${number}`)) number++;
  const id = `${type}${number}`;
  const used = new Set(config.connections.flat());
  const analog = type === 'potentiometer';
  const available = (analog ? ['gpio26', 'gpio27', 'gpio28'] : GPIO_PINS.filter(pin => !['gpio26', 'gpio27', 'gpio28'].includes(pin))).find(pin => !used.has(pin));
  const i2c = type === 'ssd1306' || type === 'aht25';
  if (!i2c && !available) throw new Error('空いている GPIO がありません。部品を削除するか配線を変更してください。');
  const part: PartConfig = { id, type, at: [type === 'ssd1306' ? 625 : 180, 120 + (config.parts.length % 3) * 110] };
  if (type === 'led') part.color = '#ef4444';
  if (type === 'sk6812') part.count = 4;
  if (i2c) {
    const address = (type === 'ssd1306' ? [0x3c, 0x3d] : [0x38]).find(value => !config.parts.some(item => item.address === value || (item.type === type && item.address === undefined && value === (type === 'ssd1306' ? 0x3c : 0x38))));
    if (address === undefined) throw new Error('この種類の I2C アドレスは使用済みです。');
    part.address = address;
  }
  const connections: [string, string][] = TERMINALS[type].map(terminal => {
    const shared = config.connections.find(pair => pair.some(endpoint => endpoint.endsWith(`.${terminal}`)));
    const target = ['gnd', 'cathode', '2'].includes(terminal) ? 'gnd' : terminal === 'vcc' ? '3v3'
      : terminal === 'sda' || terminal === 'scl' ? shared?.find(endpoint => endpoint.startsWith('gpio')) ?? (terminal === 'sda' ? 'gpio8' : 'gpio9') : available!;
    return [`${id}.${terminal}`, target];
  });
  config.parts.push(part);
  config.connections.push(...connections);
  return id;
};

export const removePart = (config: BoardConfig, id: string): void => {
  config.parts = config.parts.filter(part => part.id !== id);
  config.connections = config.connections.filter(pair => !pair.some(endpoint => endpoint.startsWith(`${id}.`)));
};

export const createBoardEditor = (root: HTMLElement, source: HTMLTextAreaElement): (() => void) => {
  let selected = '';
  let previous = '';
  const error = document.createElement('p');
  error.className = 'form-error';
  error.setAttribute('role', 'alert');
  const undo = document.createElement('button');
  undo.textContent = '編集を取り消す';
  const change = (edit: (config: BoardConfig) => void, redraw = false) => {
    try {
      const config = parseBoard(source.value);
      edit(config);
      const next = dump(config, { lineWidth: -1, noRefs: true });
      parseBoard(next);
      previous = source.value;
      source.value = next;
      source.dispatchEvent(new Event('input', { bubbles: true }));
      error.textContent = '変更を適用するとシミュレーションをリセットします。';
      undo.disabled = false;
      if (redraw) render();
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
  };
  const field = (text: string, control: HTMLElement): HTMLLabelElement => {
    const label = document.createElement('label');
    label.append(text, control);
    return label;
  };
  const render = () => {
    let config: BoardConfig;
    try { config = parseBoard(source.value); }
    catch { error.textContent = 'board.yml の書式を修正してから部品を編集してください。'; root.replaceChildren(error); return; }
    const type = document.createElement('select');
    type.id = 'new-part-type';
    for (const [value, name] of Object.entries(PART_NAMES)) type.add(new Option(name, value));
    const add = document.createElement('button');
    add.id = 'add-part';
    add.textContent = '部品を追加';
    add.onclick = () => change(board => { selected = addPart(board, type.value as PartConfig['type']); }, true);
    const selection = document.createElement('select');
    selection.id = 'selected-part';
    config.parts.forEach(part => selection.add(new Option(`${part.id} — ${PART_NAMES[part.type]}`, part.id)));
    if (!config.parts.some(part => part.id === selected)) selected = config.parts[0]?.id ?? '';
    selection.value = selected;
    selection.onchange = () => { selected = selection.value; render(); };
    const fields = document.createElement('div');
    fields.className = 'part-fields';
    const part = config.parts.find(item => item.id === selected);
    if (part) {
      const numeric = (title: string, value: number, min: number, max: number, edit: (part: PartConfig, value: number) => void) => {
        const input = document.createElement('input');
        Object.assign(input, { type: 'number', value: String(value), min: String(min), max: String(max), step: '1' });
        input.onchange = () => {
          if (!input.reportValidity()) return;
          change(board => { const item = board.parts.find(item => item.id === selected); if (item) edit(item, input.valueAsNumber); });
        };
        input.required = true;
        fields.append(field(title, input));
      };
      numeric('位置 X', part.at[0], 0, BOARD_WIDTH, (item, value) => { item.at[0] = value; });
      numeric('位置 Y', part.at[1], 0, BOARD_HEIGHT, (item, value) => { item.at[1] = value; });
      for (const terminal of TERMINALS[part.type]) {
        const endpoint = `${part.id}.${terminal}`;
        const select = document.createElement('select');
        select.add(new Option('未接続', ''));
        for (const target of [...GPIO_PINS, '3v3', 'gnd']) select.add(new Option(target.replace('gpio', 'GP'), target));
        select.value = config.connections.find(pair => pair.includes(endpoint))?.find(item => item !== endpoint) ?? '';
        select.onchange = () => change(board => {
          board.connections = board.connections.filter(pair => !pair.includes(endpoint));
          if (select.value) board.connections.push([endpoint, select.value]);
        });
        fields.append(field(terminal, select));
      }
      if (part.type === 'led') {
        const color = document.createElement('input');
        color.type = 'color'; color.value = part.color ?? '#ef4444';
        color.onchange = () => change(board => { const item = board.parts.find(item => item.id === selected); if (item) item.color = color.value; });
        fields.append(field('発光色', color));
      }
      if (part.type === 'sk6812') numeric('LED 数', part.count ?? 1, 1, 16, (item, value) => { item.count = value; });
      if (part.type === 'ssd1306' || part.type === 'aht25') numeric('I2C アドレス（10進）', part.address ?? (part.type === 'ssd1306' ? 60 : 56), 8, 119, (item, value) => { item.address = value; });
      if (part.type === 'servo') {
        numeric('0° パルス幅 µs', part.pulse_min ?? 500, 1, 10000, (item, value) => { item.pulse_min = value; });
        numeric('180° パルス幅 µs', part.pulse_max ?? 2500, 1, 10000, (item, value) => { item.pulse_max = value; });
      }
    }
    const remove = document.createElement('button');
    remove.id = 'remove-part'; remove.textContent = '選択した部品を削除'; remove.disabled = !part;
    remove.onclick = () => change(board => removePart(board, selected), true);
    undo.disabled = !previous;
    undo.onclick = () => { if (previous) { source.value = previous; previous = ''; error.textContent = ''; render(); } };
    root.replaceChildren(field('追加する部品', type), add, field('編集する部品', selection), fields, remove, undo, error);
  };
  source.addEventListener('change', render);
  render();
  return render;
};
