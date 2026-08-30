require 'js'

module Kernel
  alias picosim_original_require require
  def require(name)
    return true if %w[gpio adc pwm i2c spi ssd1306 sk6812 adafruit_sk6812 aht25].include?(name)
    picosim_original_require(name)
  end
end

class GPIO
  IN = 1
  OUT = 2
  HIGH_Z = 4
  PULL_UP = 8
  PULL_DOWN = 16
  OPEN_DRAIN = 32
  ALT = 64

  attr_reader :pin

  def initialize(pin, flags, _alt_function = 0)
    @pin = pin
    setmode(flags)
  end

  def setmode(flags, _alt_function = 0)
    JS.global[:PicoSim].pinMode(@pin, flags, flags & (PULL_UP | PULL_DOWN))
    0
  end

  def write(value)
    raise ArgumentError, 'Wrong value. 0 and 1 are only valid' unless value == 0 || value == 1
    JS.global[:PicoSim].digitalWrite(@pin, value).to_i
  end

  def read = JS.global[:PicoSim].digitalRead(@pin).to_i
  def high? = read == 1
  def low? = read == 0

  def self.read_at(pin) = JS.global[:PicoSim].digitalRead(pin).to_i
  def self.write_at(pin, value) = JS.global[:PicoSim].digitalWrite(pin, value).to_i
end

class ADC
  attr_reader :input

  def initialize(pin, _additional_params = {})
    @input = pin
  end

  def read_raw = JS.global[:PicoSim].adcRead(@input).to_i
  def read_voltage = read_raw.to_f / 65_535 * 3.3
  alias read read_voltage
end

class PWM
  def initialize(pin, frequency: 0, duty: 50)
    @pin = pin
    @frequency = frequency.to_f
    @duty = duty.to_f
    JS.global[:PicoSim].pwmOpen(@pin, @frequency, @duty)
  end

  def frequency(value)
    @frequency = value.to_f
    JS.global[:PicoSim].pwmWrite(@pin, @frequency, @duty)
    @frequency
  end

  def duty(value)
    @duty = [[value.to_f, 0].max, 100].min
    JS.global[:PicoSim].pwmWrite(@pin, @frequency, @duty)
    @duty
  end

  def period_us(value)
    raise ArgumentError, 'period must be positive' unless value > 0
    frequency(1_000_000.0 / value)
  end

  def pulse_width_us(value) = duty(value.to_f / 10_000 * @frequency)
end

class I2C
  DEFAULT_FREQUENCY = 100_000
  DEFAULT_TIMEOUT = 500

  def initialize(unit: nil, frequency: DEFAULT_FREQUENCY, sda_pin: -1, scl_pin: -1, timeout: DEFAULT_TIMEOUT)
    @timeout = timeout
    @bus = JS.global[:PicoSim].i2cOpen(sda_pin, scl_pin, frequency).to_i
  end

  def write(address, *outputs, timeout: @timeout)
    bytes = []
    outputs.each do |output|
      if output.is_a?(String)
        bytes.concat(output.bytes)
      elsif output.is_a?(Array)
        bytes.concat(output)
      else
        bytes << output
      end
    end
    result = JS.global[:PicoSim].i2cWrite(@bus, address, JS::Bridge.to_js(bytes)).to_i
    raise IOError, 'I2C write failed' if result < 0
    result
  end

  def read(address, length, *outputs, timeout: @timeout)
    write(address, *outputs, timeout: timeout) unless outputs.empty?
    bytes = JS.global[:PicoSim].i2cRead(@bus, address, length).to_a
    raise IOError, 'I2C read failed' if bytes.empty? && length > 0
    bytes.map(&:to_i).pack('C*')
  end
end

class SPI
  MSB_FIRST = 1
  LSB_FIRST = 0
  DEFAULT_FREQUENCY = 100_000

  def initialize(unit: nil, frequency: DEFAULT_FREQUENCY, sck_pin: -1, cipo_pin: -1, copi_pin: -1, cs_pin: -1, mode: 0, first_bit: MSB_FIRST)
    @cs_pin = cs_pin
  end

  def write(*outputs)
    transfer(*outputs)
    outputs.flatten.length
  end

  def read(length, repeated_tx_data = 0) = transfer(Array.new(length, repeated_tx_data))

  def transfer(*outputs, additional_read_bytes: 0)
    bytes = outputs.flatten.flat_map { |output| output.is_a?(String) ? output.bytes : output }
    bytes.concat(Array.new(additional_read_bytes, 0))
    JS.global[:PicoSim].spiTransfer(@cs_pin, JS::Bridge.to_js(bytes)).to_a.map(&:to_i).pack('C*')
  end

  def select
    return unless block_given?
    yield self
  end

  def deselect = nil
end

class SK6812
  def initialize(gpio, count: 1)
    @pin = gpio.respond_to?(:pin) ? gpio.pin : gpio
    @colors = Array.new(count) { [0, 0, 0] }
  end

  def output(r: 0, g: 0, b: 0)
    @colors[0] = [r, g, b]
    show
  end

  def []=(index, color)
    @colors[index] = color
  end

  def show
    JS.global[:PicoSim].sk6812Show(@pin, JS::Bridge.to_js(@colors.flatten))
    nil
  end
end

class SSD1306
  def initialize(i2c:, address: 0x3C, w: 128, h: 64)
    @address = address
    @width = w
    @height = h
    clear
  end

  def clear
    JS.global[:PicoSim].oledClear(@address, 0)
    nil
  end

  def fill_screen(pattern = 0xFF)
    JS.global[:PicoSim].oledClear(@address, pattern)
    update_display
  end

  def set_pixel(x, y, value = 1)
    JS.global[:PicoSim].oledPixel(@address, x, y, value)
    nil
  end

  def draw_line(x0, y0, x1, y1, value = 1)
    dx = (x1 - x0).abs
    sx = x0 < x1 ? 1 : -1
    dy = -(y1 - y0).abs
    sy = y0 < y1 ? 1 : -1
    error = dx + dy
    loop do
      set_pixel(x0, y0, value)
      break if x0 == x1 && y0 == y1
      doubled = error * 2
      error += dy and x0 += sx if doubled >= dy
      error += dx and y0 += sy if doubled <= dx
    end
    nil
  end

  def draw_rect(x, y, width, height, value = 1, filled = false)
    return nil if width <= 0 || height <= 0
    if filled
      height.times { |row| draw_line(x, y + row, x + width - 1, y + row, value) }
    else
      draw_line(x, y, x + width - 1, y, value)
      draw_line(x, y + height - 1, x + width - 1, y + height - 1, value)
      draw_line(x, y, x, y + height - 1, value)
      draw_line(x + width - 1, y, x + width - 1, y + height - 1, value)
    end
    nil
  end

  def erase(x, y, width, height) = draw_rect(x, y, width, height, 0, true)

  def draw_bytes(x:, y:, w:, h:, data:)
    h.times do |row|
      w.times do |column|
        bit = row * w + column
        set_pixel(x + column, y + row, (data.getbyte(bit / 8) >> (7 - bit % 8)) & 1)
      end
    end
    nil
  end

  def draw_text(_font, x, y, text, scale = 1)
    JS.global[:PicoSim].oledText(@address, x, y, text, scale)
    nil
  end

  def update_display
    JS.global[:PicoSim].refresh
    8
  end
  alias update_display_optimized update_display
end

class AHT25
  ADDRESS = 0x38

  def initialize(i2c:)
    @i2c = i2c
  end

  def check
    @i2c.write(ADDRESS, 0x71)
    @i2c.read(ADDRESS, 1).getbyte(0) & 0x18 == 0x18
  end

  def read
    @i2c.write(ADDRESS, 0xAC, 0x33, 0x00)
    data = @i2c.read(ADDRESS, 7).bytes
    humidity = data[1] << 12 | data[2] << 4 | ((data[3] & 0xF0) >> 4)
    temperature = ((data[3] & 0x0F) << 16) | data[4] << 8 | data[5]
    { temperature: temperature.to_f / 2**20 * 200 - 50, humidity: humidity.to_f / 2**20 * 100 }
  end
end
