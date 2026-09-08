export const EXAMPLES = [
  { name: 'ボタンで LED を操作', source: `require 'gpio'
button = GPIO.new(14, GPIO::IN | GPIO::PULL_UP)
led = GPIO.new(15, GPIO::OUT)
loop do
  led.write(button.low? ? 1 : 0)
  sleep_ms 20
end
` },
  { name: '可変抵抗で LED とサーボを操作', source: `require 'adc'
require 'pwm'
knob = ADC.new(26)
led = PWM.new(15, frequency: 1000, duty: 0)
servo = PWM.new(17, frequency: 50, duty: 7.5)
loop do
  ratio = knob.read_raw.to_f / 65535
  led.duty(ratio * 100)
  servo.pulse_width_us(500 + ratio * 2000)
  sleep_ms 40
end
` },
  { name: '温湿度を OLED に表示', source: `require 'i2c'
require 'aht25'
require 'ssd1306'
i2c = I2C.new(unit: :RP2040_I2C0, sda_pin: 8, scl_pin: 9)
sensor = AHT25.new(i2c: i2c)
display = SSD1306.new(i2c: i2c)
loop do
  reading = sensor.read
  display.clear
  display.draw_text(:terminus_6x12, 0, 0, "Temp: #{reading[:temperature].round(1)} C")
  display.draw_text(:terminus_6x12, 0, 18, "Humidity: #{reading[:humidity].round(1)} %")
  display.update_display
  sleep_ms 250
end
` },
  { name: 'ボタンで RGB LED を切り替え', source: `require 'gpio'
require 'sk6812'
button = GPIO.new(14, GPIO::IN | GPIO::PULL_UP)
pixels = SK6812.new(16, count: 4)
loop do
  4.times { |i| pixels[i] = button.low? ? [0, 120, 255] : [255, 60, 0] }
  pixels.show
  sleep_ms 40
end
` },
];
