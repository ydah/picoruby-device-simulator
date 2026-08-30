export type SPIListener = (data: Uint8Array) => Uint8Array | void;

export class SPIBus {
  private readonly listeners = new Map<number, SPIListener>();

  register(chipSelectPin: number, listener: SPIListener): void {
    this.listeners.set(chipSelectPin, listener);
  }

  transfer(chipSelectPin: number, data: Uint8Array): Uint8Array {
    return this.listeners.get(chipSelectPin)?.(data) ?? new Uint8Array(data.length);
  }
}
