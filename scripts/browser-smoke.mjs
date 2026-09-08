import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = process.env.PICOSIM_APP_URL ?? 'http://127.0.0.1:5173';
const debugUrl = process.env.PICOSIM_CHROME_DEBUG_URL ?? 'http://127.0.0.1:9222';

const ruby = `require 'gpio'
require 'adc'
require 'pwm'
require 'i2c'
require 'ssd1306'
require 'aht25'
require 'sk6812'

button = GPIO.new(14, GPIO::IN | GPIO::PULL_UP)
adc = ADC.new(26)
pwm = PWM.new(15, frequency: 1_000, duty: 25)
i2c = I2C.new(unit: :RP2040_I2C0, sda_pin: 8, scl_pin: 9)
display = SSD1306.new(i2c: i2c)
display.set_pixel(3, 4, 1)
display.draw_text(:terminus_6x12, 0, 0, 'PicoSim')
display.update_display
sensor = AHT25.new(i2c: i2c).read
pixels = SK6812.new(16, count: 4)
pixels[0] = [255, 32, 0]
pixels.show
servo = PWM.new(17, frequency: 50, duty: 7.5)
spi = SPI.new(unit: :RP2040_SPI0, cs_pin: 18)
spi_reply = nil
spi.select { spi_reply = spi.transfer("\\xA5") }
puts "ADC=#{adc.read_raw} BUTTON=#{button.read}"
puts "AHT=#{sensor[:temperature].round(1)},#{sensor[:humidity].round(1)}"
puts "SPI=#{spi_reply.bytes.join(',')} WRITE=#{spi.write('abc')}"
puts "SCAN=#{i2c.scan.inspect}"
`;
const blink = `require 'gpio'
led = GPIO.new(15, GPIO::OUT)
loop do
  led.write(1)
  sleep_ms 500
  led.write(0)
  sleep_ms 500
end
`;
const longSleep = `require 'gpio'
led = GPIO.new(15, GPIO::OUT)
sleep_ms 20000
led.write(1)
`;

const targets = await fetch(`${debugUrl}/json/list`).then((response) => response.json());
const target = targets.find(({ type, url }) => type === 'page' && url.startsWith(appUrl));
assert(target, `PicoSim page is not open at ${appUrl}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message);
  pending.delete(message.id);
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const call = (method, params = {}) => new Promise((resolve) => {
  const id = ++sequence;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  return response.result.result.value;
};
const waitFor = async (expression, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const diagnostics = await evaluate(`JSON.stringify({
    status: document.querySelector('#runtime-status')?.textContent,
    console: document.querySelector('#console')?.textContent,
  })`);
  throw new Error(`Timed out: ${expression}\n${diagnostics}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const loadSource = async (source) => {
  await evaluate(`localStorage.setItem('picosim.source', ${JSON.stringify(source)}); localStorage.removeItem('picosim.board'); history.replaceState(null, '', location.pathname + location.search); location.reload()`);
  await waitFor(`window.PicoSim && document.querySelector('#runtime-status').textContent.includes('準備')`);
};
const selectSpeed = (speed) => evaluate(`(() => {
  const select = document.querySelector('#speed');
  select.value = ${JSON.stringify(speed)};
  select.dispatchEvent(new Event('change'));
})()`);
const run = async () => {
  await evaluate(`document.querySelector('#run').click()`);
  await waitFor(`!document.querySelector('#run').disabled`);
};

await call('Runtime.enable');
if (process.env.PICOSIM_3G_MAX_MS) {
  await call('Network.enable');
  await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
  });
  await call('Page.navigate', { url: `${appUrl}?cold=${Date.now()}` });
  const elapsed = await evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 20_000;
    const check = () => {
      if (document.querySelector('#runtime-status')?.textContent === 'PicoRuby 準備完了') resolve(performance.now());
      else if (performance.now() >= deadline) reject(new Error('PicoRuby startup timed out'));
      else setTimeout(check, 5);
    };
    check();
  })`);
  console.log(`Cold Fast 3G load including PicoRuby wasm: ${elapsed}ms`);
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await call('Network.setCacheDisabled', { cacheDisabled: false });
  assert(elapsed <= Number(process.env.PICOSIM_3G_MAX_MS), `Fast 3G cold load exceeded target: ${elapsed}ms`);
}

const instant = `require 'gpio'
pin = GPIO.new(15, GPIO::OUT)
pin.write(0)
pin.write(1)
`;
await loadSource(instant);
await waitFor(`document.querySelector('#runtime-status').textContent === 'PicoRuby 準備完了'`);
assert.equal(await evaluate(`document.activeElement.matches('.cm-content')`), false, 'editor should not steal focus on load');
assert.equal(await evaluate(`document.querySelector('.cm-content').getAttribute('aria-label')`), 'main.rb の Ruby コード');
const editorColors = await evaluate(`({
  background: getComputedStyle(document.querySelector('.cm-editor')).backgroundColor,
  tokens: [...document.querySelectorAll('.cm-line span')].map(token => getComputedStyle(token).color),
})`);
const luminance = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number).map(value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
assert(editorColors.tokens.length > 0, 'Ruby source should have syntax highlighting');
for (const color of new Set(editorColors.tokens)) {
  const levels = [luminance(color), luminance(editorColors.background)].sort((a, b) => a - b);
  assert((levels[1] + 0.05) / (levels[0] + 0.05) >= 4.5, `low contrast syntax color: ${color}`);
}
await evaluate(`document.querySelector('.cm-content').focus()`);
for (const [key, keyCode] of [['Escape', 27], ['Tab', 9]]) {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode });
}
assert.equal(await evaluate(`document.activeElement.matches('.cm-content')`), false, 'Esc then Tab should leave the editor');
for (const attempt of ['prepared', 'repeat']) {
  const latency = await evaluate(`new Promise((resolve) => {
    const started = performance.now();
    const timeout = setTimeout(() => resolve(Infinity), 1_000);
    document.querySelector('#run').click();
    const check = () => window.PicoSim.bus.history.length
      ? (clearTimeout(timeout), resolve(performance.now() - started))
      : setTimeout(check, 0);
    check();
  })`);
  assert(latency <= 200, `${attempt} execution start exceeded 200ms: ${latency}ms`);
  console.log(`${attempt} execution start: ${Math.round(latency)}ms`);
  await waitFor(`!document.querySelector('#run').disabled`);
}

const sharedSource = 'puts "共有✓"';
await loadSource(sharedSource);
await evaluate(`Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (url) => { window.copiedUrl = url; } },
}); document.querySelector('#share').click()`);
await waitFor(`Boolean(window.copiedUrl)`);
assert.equal(await evaluate(`window.copiedUrl.includes('&board=')`), true);
await evaluate(`localStorage.setItem('picosim.source', 'puts "wrong"'); location.href = window.copiedUrl; location.reload()`);
await waitFor(`document.querySelector('.cm-line')?.textContent === ${JSON.stringify(sharedSource)}`);
await evaluate(`localStorage.setItem('picosim.source', 'puts "fallback"'); location.hash = 'code=***'; location.reload()`);
await waitFor(`document.querySelector('.cm-line')?.textContent === 'puts "fallback"'`);

await loadSource(ruby);
await run();
await waitFor(`document.querySelector('#console').textContent.includes('AHT=')`);

const result = JSON.parse(await evaluate(`JSON.stringify((() => {
  const devices = window.PicoSim.board.devices;
  const button = devices.find((device) => device.type === 'button');
  button.pointer(true);
  const oled = devices.find((device) => device.type === 'ssd1306');
  const pixels = devices.find((device) => device.type === 'sk6812');
  return {
    output: document.querySelector('#console').textContent,
    button: window.PicoSim.digitalRead(14),
    oledPixel: oled.framebuffer[3] & 16,
    pixelColor: pixels.colors[0],
    pwm: window.PicoSim.bus.read(15),
    servo: window.PicoSim.bus.read(17),
    spiHistory: window.PicoSim.bus.history.filter(({ pin }) => pin === 18).map(({ v }) => v),
  };
})())`));

assert.match(result.output, /ADC=32768 BUTTON=1/);
assert.match(result.output, /AHT=24\.0,50\.0/);
assert.match(result.output, /SPI=0 WRITE=3/);
assert.match(result.output, /I2C device found at 7-bit address 0x38/);
assert.match(result.output, /SCAN=nil/);
assert.equal(result.button, 0);
assert.equal(result.oledPixel, 16);
assert.equal(result.pixelColor, 'rgb(255, 32, 0)');
assert.equal(result.pwm, 0.25);
assert.equal(result.servo, 0.075);
assert.deepEqual(result.spiHistory, [1, 0, 1]);

assert.equal(await evaluate(`(() => {
  const control = [...document.querySelectorAll('#device-controls button')].find(({ textContent }) => textContent.includes('btn1'));
  if (!control) return false;
  control.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  const pressed = window.PicoSim.digitalRead(14);
  control.dispatchEvent(new FocusEvent('blur'));
  return pressed === 0 && window.PicoSim.digitalRead(14) === 1;
})()`), true);

await evaluate(`document.querySelector('#new-part-type').value = 'led'; document.querySelector('#add-part').click()`);
assert.equal(await evaluate(`document.querySelector('#board-source').value.includes('id: led2')`), true);
await evaluate(`document.querySelector('#apply-board').click()`);
assert.equal(await evaluate(`window.PicoSim.board.devices.length`), 8);
await evaluate(`location.reload()`);
await waitFor(`window.PicoSim?.board?.devices.length === 8`);
await evaluate(`document.querySelector('#selected-part').value = 'led2'; document.querySelector('#selected-part').dispatchEvent(new Event('change')); document.querySelector('#remove-part').click(); document.querySelector('#apply-board').click()`);
assert.equal(await evaluate(`window.PicoSim.board.devices.length`), 7);

await evaluate(`document.querySelector('#move-parts').checked = true; document.querySelector('#board').scrollIntoView({block: 'center'})`);
const drag = await evaluate(`(() => {
  const rect = document.querySelector('#board').getBoundingClientRect();
  return { x: rect.left + 110 / 800 * rect.width, y: rect.top + 90 / 480 * rect.height, end: rect.left + 180 / 800 * rect.width };
})()`);
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: drag.x, y: drag.y, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: drag.end, y: drag.y, button: 'left', buttons: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drag.end, y: drag.y, button: 'left', clickCount: 1 });
assert.equal(await evaluate(`window.PicoSim.board.devices.find(device => device.id === 'led1').at.x`), 180);
await evaluate(`document.querySelector('#move-parts').checked = false; document.querySelector('#apply-board').click()`);
assert.equal(await evaluate(`window.PicoSim.board.config.parts.find(part => part.id === 'led1').at[0]`), 180);
await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async url => { window.projectUrl = url; } } }); document.querySelector('#share').click()`);
await waitFor(`Boolean(window.projectUrl)`);
await evaluate(`localStorage.removeItem('picosim.board'); history.replaceState(null, '', window.projectUrl); location.reload()`);
await waitFor(`window.PicoSim?.board?.config.parts.find(part => part.id === 'led1')?.at[0] === 180`);

await evaluate(`document.querySelector('#example').value = '0'; document.querySelector('#load-example').click(); document.querySelector('#example-dialog').close('load')`);
await waitFor(`document.querySelector('.cm-content').textContent.includes('led.write(button.low?')`);
await run();
await evaluate(`document.querySelector('#device-controls button').dispatchEvent(new KeyboardEvent('keydown', {key: ' '}))`);
await waitFor(`window.PicoSim.bus.read(15) === 1`);
await evaluate(`document.querySelector('#device-controls button').dispatchEvent(new KeyboardEvent('keyup', {key: ' '}))`);
await waitFor(`window.PicoSim.bus.read(15) === 0`);

await evaluate(`document.querySelector('#example').value = '3'; document.querySelector('#load-example').click(); document.querySelector('#example-dialog').close('load')`);
await waitFor(`document.querySelector('.cm-content').textContent.includes('pixels[i]')`);
await run();
await waitFor(`window.PicoSim.board.devices.find(device => device.type === 'sk6812').colors[0] === 'rgb(255, 60, 0)'`);
await evaluate(`document.querySelector('#device-controls button').dispatchEvent(new KeyboardEvent('keydown', {key: ' '}))`);
await waitFor(`window.PicoSim.board.devices.find(device => device.type === 'sk6812').colors[0] === 'rgb(0, 120, 255)'`);

await evaluate(`document.querySelector('#example').value = '1'; document.querySelector('#load-example').click()`);
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await waitFor(`!document.querySelector('#example-dialog').open`);
assert.equal(await evaluate(`document.querySelector('.cm-content').textContent.includes('pixels[i]')`), true, 'cancel must preserve code after a previous example load');
await evaluate(`document.querySelector('#load-example').click()`);
assert.equal(await evaluate(`document.querySelector('#example-dialog').open`), true);
await evaluate(`document.querySelector('#example-dialog').close('load')`);
await waitFor(`document.querySelector('.cm-content').textContent.includes('ratio =')`);
await run();
await waitFor(`window.PicoSim.servos()[0].angle > 85 && window.PicoSim.servos()[0].angle < 95`);
await evaluate(`(() => { const range = document.querySelector('#device-controls input[type=range]'); range.value = '65535'; range.dispatchEvent(new Event('input')); })()`);
await waitFor(`window.PicoSim.servos()[0].angle === 180 && window.PicoSim.bus.read(15) === 1`);
await evaluate(`document.querySelector('#reset').click()`);
assert.equal(await evaluate(`window.PicoSim.clock.now() === 0 && window.PicoSim.bus.read(15) === 0`), true);

await evaluate(`document.querySelector('#example').value = '2'; document.querySelector('#load-example').click(); document.querySelector('#example-dialog').close('load')`);
await waitFor(`document.querySelector('.cm-content').textContent.includes('reading = sensor.read')`);
await run();
await waitFor(`window.PicoSim.board.devices.find(device => device.type === 'ssd1306').texts.some(item => item.text.includes('Humidity'))`);
await evaluate(`(() => { const humidity = [...document.querySelectorAll('#device-controls input[type=number]')].at(-1); humidity.value = '100'; humidity.dispatchEvent(new Event('input')); })()`);
await waitFor(`window.PicoSim.board.devices.find(device => device.type === 'ssd1306').texts.some(item => item.text.includes('100.0'))`);
await evaluate(`document.querySelector('#stop').click()`);

await loadSource(longSleep);
await selectSpeed('step');
await run();
await waitFor(`document.querySelector('#runtime-status').textContent.includes('ステップ待機')`);
assert.deepEqual(JSON.parse(await evaluate(`JSON.stringify(window.PicoSim.bus.history.filter(({ pin }) => pin === 15))`)), []);
await evaluate(`document.querySelector('#step').click()`);
await waitFor(`window.PicoSim.bus.history.some(({ pin }) => pin === 15)`);
assert.equal(await evaluate(`window.PicoSim.bus.history.find(({ pin }) => pin === 15).t >= 20000`), true);

await loadSource(blink);
await selectSpeed('step');
await run();
assert.deepEqual(JSON.parse(await evaluate(`JSON.stringify(window.PicoSim.bus.history.filter(({ pin }) => pin === 15))`)), [{ t: 0, pin: 15, v: 1 }]);
await evaluate(`document.querySelector('#step').click()`);
await waitFor(`window.PicoSim.bus.history.filter(({ pin }) => pin === 15).length === 2`);
assert.deepEqual(JSON.parse(await evaluate(`JSON.stringify(window.PicoSim.bus.history.filter(({ pin }) => pin === 15))`)), [
  { t: 0, pin: 15, v: 1 },
  { t: 500, pin: 15, v: 0 },
]);

await selectSpeed('realtime');
await waitFor(`window.PicoSim.clock.now() >= 700`);
const realtimeStart = await evaluate(`window.PicoSim.clock.now()`);
await delay(250);
const realtimeDelta = await evaluate(`window.PicoSim.clock.now() - ${realtimeStart}`);
await selectSpeed('fast');
const fastStart = await evaluate(`window.PicoSim.clock.now()`);
await delay(250);
const fastDelta = await evaluate(`window.PicoSim.clock.now() - ${fastStart}`);
assert(fastDelta > realtimeDelta * 4, `×10 mode was not faster: realtime=${realtimeDelta}, fast=${fastDelta}`);

for (let index = 0; index < 6; index++) {
  await selectSpeed(index % 2 ? 'realtime' : 'step');
}
const toggleStart = await evaluate(`window.PicoSim.clock.now()`);
await delay(300);
const toggleDelta = await evaluate(`window.PicoSim.clock.now() - ${toggleStart}`);
assert(toggleDelta < 550, `rapid speed changes duplicated the scheduler: ${toggleDelta}ms virtual time`);

await evaluate(`document.querySelector('#stop').click()`);
const stopped = JSON.parse(await evaluate(`JSON.stringify({ time: window.PicoSim.clock.now(), events: window.PicoSim.bus.history.length })`));
await delay(150);
assert.deepEqual(JSON.parse(await evaluate(`JSON.stringify({ time: window.PicoSim.clock.now(), events: window.PicoSim.bus.history.length })`)), stopped);

await selectSpeed('step');
await run();
assert.deepEqual(JSON.parse(await evaluate(`JSON.stringify(window.PicoSim.bus.history.filter(({ pin }) => pin === 15))`)), [{ t: 0, pin: 15, v: 1 }]);

await evaluate(`window.savedBoard = window.PicoSim.board; window.savedBus = window.PicoSim.bus`);
await evaluate(`(() => {
  document.querySelector('#board-source').value = 'not: a board';
  document.querySelector('#apply-board').click();
})()`);
assert.equal(await evaluate(`window.PicoSim.board === window.savedBoard && window.PicoSim.bus === window.savedBus`), true);
assert.equal(await evaluate(`document.querySelector('#runtime-status').classList.contains('error')`), true);
assert.equal(await evaluate(`document.querySelector('#board-source').getAttribute('aria-invalid')`), 'true');
assert.equal(await evaluate(`document.querySelector('#warnings').textContent === document.querySelector('#runtime-status').textContent`), true);

await evaluate(`(() => {
  document.querySelector('#board-source').value = 'board: pico_w\\nparts:\\n  - {id: led1, type: led, at: [0, 0]}\\nconnections:\\n  - [led1.anode, gpio15]';
  document.querySelector('#apply-board').click();
})()`);
assert.match(await evaluate(`document.querySelector('#warnings').textContent`), /gnd/);
assert.equal(await evaluate(`document.querySelector('#board-source').hasAttribute('aria-invalid')`), false);

const loadBoard = `board: pico_w
parts:
${Array.from({ length: 8 }, (_, index) => `  - {id: led${index}, type: led, at: [${80 + index * 60}, 260]}`).join('\n')}
  - {id: oled, type: ssd1306, address: 0x3c, at: [360, 100]}
connections:
${Array.from({ length: 8 }, (_, index) => `  - [led${index}.anode, gpio${10 + index}]\n  - [led${index}.cathode, gnd]`).join('\n')}
  - [oled.sda, gpio8]
  - [oled.scl, gpio9]
  - [oled.vcc, 3v3]
  - [oled.gnd, gnd]`;
await evaluate(`(() => {
  document.querySelector('#board-source').value = ${JSON.stringify(loadBoard)};
  document.querySelector('#apply-board').click();
})()`);
assert.equal(await evaluate(`window.PicoSim.board.devices.length`), 9);
const frames = await evaluate(`new Promise((resolve) => {
  let count = 0;
  const started = performance.now();
  const frame = (now) => {
    count++;
    if (now - started >= 1000) resolve(count);
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})`);
assert(frames >= 55, `8 LEDs + OLED rendered below 55fps: ${frames}`);

for (const width of [375, 768, 1024, 1120, 1280, 1440]) {
  await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, `horizontal overflow at ${width}px`);
  assert.equal(await evaluate(`(() => {
    const canvas = document.querySelector('#board');
    const rect = canvas.getBoundingClientRect();
    return Math.abs(rect.width / rect.height - canvas.width / canvas.height) < 0.01;
  })()`), true, `board canvas aspect ratio changed at ${width}px`);
  if (width === 375) {
    assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('#board-source')).fontSize) >= 16`), true);
    assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize) >= 16`), true);
  }
}
await evaluate(`document.querySelector('#board-zoom').value = '150'; document.querySelector('#board-zoom').dispatchEvent(new Event('change'))`);
assert.equal(await evaluate(`document.querySelector('#board').getBoundingClientRect().width`), 1200);
assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'zoom should scroll within the board');
await evaluate(`document.querySelector('#board-zoom').value = '0'; document.querySelector('#board-zoom').dispatchEvent(new Event('change'))`);
await call('Emulation.clearDeviceMetricsOverride');

if (process.env.PICOSIM_SSD1306_SAMPLE) {
  await loadSource(await readFile(process.env.PICOSIM_SSD1306_SAMPLE, 'utf8'));
  await selectSpeed('fast');
  await run();
  await waitFor(`document.querySelector('#console').textContent.includes('SSD1306 demo completed!')`, 30_000);
  assert(await evaluate(`(() => {
    const display = window.PicoSim.board.devices.find(({ type }) => type === 'ssd1306');
    return display.framebuffer.some(Boolean) || display.texts.length > 0;
  })()`));
}

await loadSource(`raise 'adversarial failure'`);
await run();
await waitFor(`document.querySelector('#console').textContent.includes('adversarial failure')`);
assert.equal(await evaluate(`document.querySelector('#runtime-status').classList.contains('error')`), true);

await call('Page.enable');
const blockedStorage = await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new DOMException('blocked'); } })`,
});
await evaluate(`location.reload()`);
await waitFor(`window.PicoSim && document.querySelector('#runtime-status').textContent.includes('準備')`);
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockedStorage.result.identifier });
const missingSerial = await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `Object.defineProperty(Navigator.prototype, 'serial', { configurable: true, get: () => undefined })`,
});
await evaluate(`location.reload()`);
await waitFor(`document.querySelector('#flash')?.disabled`);
assert.match(await evaluate(`document.querySelector('#flash').title`), /Chrome \/ Edge/);
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: missingSerial.result.identifier });
socket.close();
console.log('Browser smoke test passed: devices, buses, clock modes, lifecycle, 200ms start, sharing, errors, unsupported serial, storage denial, board rollback, responsive layout');
