# PicoSim

PicoSim runs PicoRuby code in the browser and visualizes GPIO and peripheral behavior on a canvas. The same Ruby source can be transferred to an R2P2 device over Web Serial.

PicoSim is a simulator, not an RP2040 emulator. It reproduces PicoRuby peripheral APIs but does not model cycle-accurate execution, current, voltage drop, precise interrupt timing, or PIO.

## Getting started

Node.js 20.19.x or 22.12.0 and later is required.

```sh
npm ci
npm run dev
```

Open the displayed URL in a browser. Simulation works in modern browsers. Device transfer requires Chrome or Edge with Web Serial support and a Raspberry Pi Pico running R2P2.

## Usage

1. Edit `main.rb`, or load a combination example: button + LED, potentiometer + LED + servo, temperature/humidity + OLED, or button + RGB LEDs. Loading an example asks before replacing code and wiring.
2. In the parts panel, add a component, choose its pins, and edit its position, LED color/count, I2C address, or servo pulse calibration. New components get available GPIOs and power connections. Apply the wiring to activate and save changes. The undo button restores the previous parts edit.
3. Select Run. Press buttons directly on the canvas or with the keyboard using the controls below it. Adjust the potentiometer, temperature, and humidity while the program runs. The potentiometer shows its raw ADC value and voltage.
4. Enable component movement to drag parts, or use the X/Y fields. Apply wiring to save the new positions. Use 100% or 150% zoom to inspect the board; the enlarged canvas scrolls within its panel.
5. Choose real-time, 10x, or step execution. Next Event advances to a GPIO/PWM change, peripheral I/O, or serial output. The trace selector can display an individual pin; the readout includes analog voltage and PWM frequency/duty. Reset stops execution, clears outputs and time, and retains environmental inputs.
6. Expand `board.yml` for direct YAML editing. In Chrome or Edge, Transfer to Device writes and runs the source as `main.rb` on the connected device.

Editor content and applied wiring are saved in `localStorage`. Share embeds both code and wiring in the URL fragment and copies the URL to the clipboard. Older code-only links remain supported. Code and wiring are never sent to a server.

## Simulated APIs and components

- `GPIO`: input, output, pull-up/down, and pin history
- `PWM`: frequency, duty cycle, period, and pulse width
- `ADC`: 16-bit raw values and 3.3 V conversion
- `I2C`: address-based device routing
- `SPI`: write, read, transfer, and chip select
- LED, push button, potentiometer, and servo
- SSD1306: page and horizontal addressing, drawing APIs, inversion, and display on/off
- SK6812: `output` and color-array `show`
- AHT25: temperature and humidity readings

The simulator classes in [src/simhal.rb](src/simhal.rb) match the constants and public signatures in PicoRuby 4. User code containing calls such as `require 'gpio'` can be transferred to a device without modification.

## `board.yml`

Each component has an `id`, a `type`, and an `at: [x, y]` canvas position. `connections` link component terminals to `gpioN`, `gnd`, or `3v3`.

```yaml
board: pico_w
parts:
  - id: led1
    type: led
    color: "#ef4444"
    at: [345, 105]
connections:
  - [led1.anode, gpio15]
  - [led1.cathode, gnd]
```

Supported component types are `led`, `button`, `potentiometer`, `ssd1306`, `sk6812`, `aht25`, and `servo`. PicoSim warns about missing ground or power connections and duplicate signal GPIO assignments. Shared I2C SDA and SCL pins do not trigger duplicate-pin warnings.

The board view follows the [official Pico W header pinout](https://datasheets.raspberrypi.com/picow/PicoW-A4-Pinout.pdf). GPIO names are distinct from physical pin numbers. External wiring accepts GP0–22 and GP26–28; potentiometers should connect to ADC-capable GP26–28. Positions use an 800×480 canvas. RGB strips support 1–16 LEDs, displayed in rows of up to eight.

Servo positions are calculated from PWM pulse width, including frequency changes. The default 0–180° range is 500–2500 µs; set `pulse_min` and `pulse_max` in the parts editor or YAML to match the intended servo. This is a configurable model, not a guarantee of physical travel.

## Device transfer

PicoSim calls `navigator.serial.requestPort()` directly from the transfer button's click handler to satisfy the browser's user-activation requirement. It opens the port at 115200 baud, sends Ctrl-C to stop the current process, and sends Ctrl-B to enter the current R2P2 RBTP transfer mode. It writes `/home/main.rb` in 480-byte chunks, verifies each response and checksum, and then runs the file.

Successful simulation does not guarantee identical behavior on physical hardware. Recheck pin wiring, power, sensor variation, PWM frequency error, and execution timing on the target device.

## Testing and building

```sh
npm test
npm run build
```

To run the browser smoke test, start the development server and Chrome with remote debugging enabled on port 9222.

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new --remote-debugging-port=9222 --remote-allow-origins='*' \
  --user-data-dir=/tmp/picosim-chrome http://127.0.0.1:5173
npm run test:browser
```

The browser test covers GPIO, ADC, PWM, I2C, SSD1306, AHT25, SK6812, buttons, servos, and step execution using the simulator's reduced PicoRuby 4.0.3 WASM build.

To test the cold-load budget under Fast 3G conditions (1.6 Mbps and 150 ms latency) with gzip delivery equivalent to GitHub Pages, first run `npm run build && npm run preview:gzip`, then run the following command in another terminal:

```sh
PICOSIM_APP_URL=http://127.0.0.1:4180 PICOSIM_3G_MAX_MS=3000 npm run test:browser
```

`npm run build` produces a self-contained static site in `dist/`. Pushes to `main` build and deploy the site through the GitHub Pages workflow. Configure the repository's Pages source to use GitHub Actions.

## Known differences

- Step execution advances to the next GPIO, peripheral I/O, or serial output event. An infinite loop with no hardware event has no stopping point; use Stop to cancel a pending step.
- Unsupported SSD1306 commands are ignored. Text uses an approximate browser monospace font and does not match the physical BDF glyphs exactly.
- SK6812 simulation does not decode the GPIO bitstream. The simulator-specific `SK6812` class passes its color array directly to the virtual strip.
- SPI returns a zero-filled byte sequence of the requested length when no device is registered.
- I2C addresses must be unique across the current board. Two OLEDs can use 0x3c and 0x3d; independent buses with duplicate addresses are not yet modeled.
- Pin traces show digital levels, normalized ADC values, and PWM duty envelopes, not individual high-frequency PWM pulses. Select a pin to inspect it beyond the six-pin overview.
- Power wiring produces warnings; this API-level simulator does not compute electrical circuits. SPI has a programmatic bus but no visual SPI peripheral in the parts menu.
- Web Serial is available only in a secure HTTPS or localhost context.
- The WASM binary is built from the same source as `@picoruby/wasm-wasi` 4.0.3 with additional gems unused by the simulator removed. It is 1.0 MB raw, approximately 378 KB with gzip, and approximately 312 KB with Brotli. Reproduction instructions and license information are in `wasm/picoruby/`.
