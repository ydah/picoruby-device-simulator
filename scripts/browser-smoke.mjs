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
  await evaluate(`localStorage.setItem('picosim.source', ${JSON.stringify(source)}); location.reload()`);
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
  const started = Date.now();
  await call('Page.navigate', { url: `${appUrl}?cold=${started}` });
  await waitFor(`document.querySelector('#runtime-status')?.textContent === 'PicoRuby 準備完了'`, 20_000);
  const elapsed = Date.now() - started;
  console.log(`Cold Fast 3G load including PicoRuby wasm: ${elapsed}ms`);
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await call('Network.setCacheDisabled', { cacheDisabled: false });
  assert(elapsed <= Number(process.env.PICOSIM_3G_MAX_MS), `Fast 3G cold load exceeded target: ${elapsed}ms`);
}
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

await loadSource(blink);
await selectSpeed('step');
await run();
await waitFor(`document.querySelector('#runtime-status').textContent.includes('ステップ待機')`);
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

await evaluate(`(() => {
  document.querySelector('#board-source').value = 'board: pico_w\\nparts:\\n  - {id: led1, type: led, at: [0, 0]}\\nconnections:\\n  - [led1.anode, gpio15]';
  document.querySelector('#apply-board').click();
})()`);
assert.match(await evaluate(`document.querySelector('#warnings').textContent`), /gnd/);

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

for (const width of [375, 768, 1024, 1440]) {
  await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, `horizontal overflow at ${width}px`);
  if (width === 375) {
    assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('#board-source')).fontSize) >= 16`), true);
    assert.equal(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize) >= 16`), true);
  }
}
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
socket.close();
console.log('Browser smoke test passed: devices, buses, clock modes, lifecycle, errors, storage denial, board rollback, responsive layout');
