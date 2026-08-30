export interface I2CDevice {
  write(data: Uint8Array): number;
  read(length: number): Uint8Array;
}

export class I2CBus {
  private readonly devices = new Map<number, I2CDevice>();

  register(address: number, device: I2CDevice): void {
    if (!Number.isInteger(address) || address < 0x08 || address > 0x77) {
      throw new RangeError(`I2C address must be from 0x08 to 0x77: ${address}`);
    }
    this.devices.set(address, device);
  }

  write(address: number, data: Uint8Array): number {
    return this.devices.get(address)?.write(data) ?? -1;
  }

  read(address: number, length: number): Uint8Array {
    return this.devices.get(address)?.read(length) ?? new Uint8Array();
  }

  has(address: number): boolean {
    return this.devices.has(address);
  }
}
