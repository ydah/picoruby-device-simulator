import { afterEach, describe, expect, it, vi } from 'vitest';
import { transferToR2P2, webSerialAvailable } from './transfer';

const crc16 = (data: Uint8Array) => {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? crc << 1 ^ 0x1021 : crc << 1;
  }
  return crc & 0xffff;
};
const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  return (~crc) >>> 0;
};
const frame = (command: number, payload: Uint8Array) => {
  const body = Uint8Array.of(command, ...payload);
  const result = new Uint8Array(body.length + 5);
  const view = new DataView(result.buffer);
  result[0] = 2;
  view.setUint16(1, body.length);
  result.set(body, 3);
  view.setUint16(result.length - 2, crc16(body));
  return result;
};

describe('Web Serial transfer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes and verifies main.rb with the current R2P2 binary protocol', async () => {
    const chunks: Uint8Array[] = [];
    const content: Uint8Array[] = [];
    let expectedSize = 0;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({ start: (value) => { controller = value; } });
    const respond = (data: Uint8Array) => data.forEach((byte) => controller.enqueue(Uint8Array.of(byte)));
    const port = {
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      readable,
      writable: new WritableStream<Uint8Array>({ write: (chunk) => {
        chunks.push(chunk);
        if (chunk.length === 1 && chunk[0] === 2) {
          respond(Uint8Array.of(10, 94, 66, 6));
          return;
        }
        if (chunk[0] !== 2 || chunk.length === 1) return;
        const length = new DataView(chunk.buffer, chunk.byteOffset).getUint16(1);
        const body = chunk.slice(3, 3 + length);
        expect(new DataView(chunk.buffer, chunk.byteOffset).getUint16(chunk.length - 2)).toBe(crc16(body));
        if (body[0] === 0x02) {
          expectedSize = new DataView(body.buffer, body.byteOffset).getUint32(1);
          expect(new TextDecoder().decode(body.slice(5))).toBe('/home/main.rb');
          respond(frame(0x82, Uint8Array.of(1)));
        } else if (body[0] === 0x04) {
          content.push(body.slice(1));
          respond(frame(0x84, Uint8Array.of(0)));
          const written = Uint8Array.from(content.flatMap((part) => [...part]));
          if (written.length === expectedSize) {
            const done = new Uint8Array(5);
            new DataView(done.buffer).setUint32(1, crc32(written));
            respond(frame(0x8f, done));
          }
        }
      } }),
    };
    vi.stubGlobal('navigator', { serial: { requestPort: vi.fn(async () => port) } });

    expect(webSerialAvailable()).toBe(true);
    const source = 'puts "PicoRuby"\n'.repeat(40);
    await transferToR2P2(source);

    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(port.close).toHaveBeenCalledOnce();
    expect([...chunks[0]]).toEqual([3]);
    expect([...chunks[1]]).toEqual([2]);
    expect(content).toHaveLength(2);
    expect(new TextDecoder().decode(Uint8Array.from(content.flatMap((part) => [...part])))).toBe(source);
    expect(new TextDecoder().decode(chunks.at(-1))).toBe('/home/main.rb\r\n');
  });

  it('closes a port without readable and writable streams', async () => {
    const port = { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined), readable: null, writable: null };
    vi.stubGlobal('navigator', { serial: { requestPort: vi.fn(async () => port) } });
    await expect(transferToR2P2('')).rejects.toThrow('読み書きできません');
    expect(port.close).toHaveBeenCalledOnce();
  });
});
