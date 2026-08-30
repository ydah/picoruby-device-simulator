import assert from 'node:assert/strict';

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
i2c = I2C.new(unit: :RP2040_I2C0, sda_pin: 4, scl_pin: 5)
display = SSD1306.new(i2c: i2c)
display.set_pixel(3, 4, 1)
display.draw_text(:terminus_6x12, 0, 0, 'PicoSim')
display.update_display
sensor = AHT25.new(i2c: i2c).read
pixels = SK6812.new(16, count: 4)
pixels[0] = [255, 32, 0]
pixels.show
servo = PWM.new(17, frequency: 50, duty: 7.5)
puts "ADC=#{adc.read_raw} BUTTON=#{button.read}"
puts "AHT=#{sensor[:temperature].round(1)},#{sensor[:humidity].round(1)}"
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

const targets = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json());
const target = targets.find(({ type, url }) => type === 'page' && url.startsWith('http://127.0.0.1:5173'));
assert(target, 'PicoSim page is not open on Chrome debug port 9222');

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
  throw new Error(`Timed out: ${expression}`);
};

await call('Runtime.enable');
await evaluate(`localStorage.setItem('picosim.source', ${JSON.stringify(ruby)}); location.reload()`);
await waitFor(`window.PicoSim && document.querySelector('#runtime-status').textContent.includes('準備')`);
await evaluate(`document.querySelector('#run').click()`);
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
  };
})())`));

assert.match(result.output, /ADC=32768 BUTTON=1/);
assert.match(result.output, /AHT=24\.0,50\.0/);
assert.equal(result.button, 0);
assert.equal(result.oledPixel, 16);
assert.equal(result.pixelColor, 'rgb(255, 32, 0)');
assert.equal(result.pwm, 0.25);
assert.equal(result.servo, 0.075);

await evaluate(`localStorage.setItem('picosim.source', ${JSON.stringify(blink)}); location.reload()`);
await waitFor(`window.PicoSim && document.querySelector('#runtime-status').textContent.includes('準備')`);
await evaluate(`(() => {
  const speed = document.querySelector('#speed');
  speed.value = 'step';
  speed.dispatchEvent(new Event('change'));
  document.querySelector('#run').click();
})()`);
await waitFor(`document.querySelector('#runtime-status').textContent.includes('ステップ待機')`);
assert.deepEqual(JSON.parse(await evaluate(`JSON.stringify(window.PicoSim.bus.history.filter(({ pin }) => pin === 15))`)), [{ t: 0, pin: 15, v: 1 }]);
await evaluate(`document.querySelector('#step').click()`);
await waitFor(`window.PicoSim.bus.history.filter(({ pin }) => pin === 15).length === 2`);
assert.deepEqual(JSON.parse(await evaluate(`JSON.stringify(window.PicoSim.bus.history.filter(({ pin }) => pin === 15))`)), [
  { t: 0, pin: 15, v: 1 },
  { t: 500, pin: 15, v: 0 },
]);
socket.close();
console.log('Browser smoke test passed: devices, I/O buses, virtual clock step mode');
