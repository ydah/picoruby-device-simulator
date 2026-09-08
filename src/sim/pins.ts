// Physical header order, USB connector at the top.
// https://datasheets.raspberrypi.com/picow/PicoW-A4-Pinout.pdf
export const PICO_HEADERS = [
  ['gpio0', 'gpio1', 'gnd', 'gpio2', 'gpio3', 'gpio4', 'gpio5', 'gnd', 'gpio6', 'gpio7', 'gpio8', 'gpio9', 'gnd', 'gpio10', 'gpio11', 'gpio12', 'gpio13', 'gnd', 'gpio14', 'gpio15'],
  ['vbus', 'vsys', 'gnd', '3v3_en', '3v3', 'adc_vref', 'gpio28', 'agnd', 'gpio27', 'gpio26', 'run', 'gpio22', 'gnd', 'gpio21', 'gpio20', 'gpio19', 'gpio18', 'gnd', 'gpio17', 'gpio16'],
];
export const GPIO_PINS = PICO_HEADERS.flat().filter(pin => pin.startsWith('gpio')).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
export const BOARD_WIDTH = 800;
export const BOARD_HEIGHT = 480;
export const headerPosition = (side: number, row: number): [number, number] => [side ? 440 : 360, 88 + row * 15];
export const pinPosition = (target: string): [number, number] | undefined => {
  for (let side = 0; side < PICO_HEADERS.length; side++) {
    const row = PICO_HEADERS[side].indexOf(target);
    if (row >= 0) return headerPosition(side, row);
  }
  return undefined;
};
