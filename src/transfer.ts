interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface SerialNavigator extends Navigator {
  serial?: { requestPort(): Promise<SerialPort> };
}

const FILE_WRITE = 0x02;
const CHUNK = 0x04;
const FILE_ACK = 0x82;
const CHUNK_ACK = 0x84;
const DONE_ACK = 0x8f;
const ERROR = 0xfe;
const READY = 0x01;
const CHUNK_SIZE = 480;
const TIMEOUT_MS = 5_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const crc16 = (data: Uint8Array): number => {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? crc << 1 ^ 0x1021 : crc << 1;
  }
  return crc & 0xffff;
};

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  return (~crc) >>> 0;
};

const frame = (command: number, payload = new Uint8Array()): Uint8Array => {
  const body = Uint8Array.of(command, ...payload);
  const output = new Uint8Array(body.length + 5);
  const view = new DataView(output.buffer);
  output[0] = 0x02;
  view.setUint16(1, body.length);
  output.set(body, 3);
  view.setUint16(output.length - 2, crc16(body));
  return output;
};

export const webSerialAvailable = (): boolean => Boolean((navigator as SerialNavigator).serial);

export const transferToR2P2 = async (source: string): Promise<void> => {
  const serial = (navigator as SerialNavigator).serial;
  if (!serial) throw new Error('Web Serial は Chrome / Edge でのみ利用できます');
  const portPromise = serial.requestPort();
  const port = await portPromise;
  await port.open({ baudRate: 115200 });
  try {
    if (!port.readable || !port.writable) throw new Error('シリアルポートを読み書きできません');
    const reader = port.readable.getReader();
    const writer = port.writable.getWriter();
    let buffered = new Uint8Array();
    const readExact = async (length: number, deadline = Date.now() + TIMEOUT_MS): Promise<Uint8Array> => {
      while (buffered.length < length) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('R2P2 からの応答がタイムアウトしました');
        let timer = 0;
        const timeout = new Promise<never>((_, reject) => {
          timer = globalThis.setTimeout(() => reject(new Error('R2P2 からの応答がタイムアウトしました')), remaining);
        });
        const { value, done } = await Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
        if (done || !value) throw new Error('R2P2 との接続が切断されました');
        const next = new Uint8Array(buffered.length + value.length);
        next.set(buffered);
        next.set(value, buffered.length);
        buffered = next;
      }
      const result = buffered.slice(0, length);
      buffered = buffered.slice(length);
      return result;
    };
    const readFrame = async (): Promise<{ command: number; payload: Uint8Array }> => {
      const deadline = Date.now() + TIMEOUT_MS;
      if ((await readExact(1, deadline))[0] !== 0x02) throw new Error('R2P2 から不正なフレームを受信しました');
      const length = new DataView((await readExact(2, deadline)).buffer).getUint16(0);
      const body = await readExact(length, deadline);
      const expected = new DataView((await readExact(2, deadline)).buffer).getUint16(0);
      if (crc16(body) !== expected) throw new Error('R2P2 からの応答のCRCが一致しません');
      if (body[0] === ERROR) throw new Error(`R2P2: ${new TextDecoder().decode(body.slice(1))}`);
      return { command: body[0], payload: body.slice(1) };
    };
    const expect = async (command: number, status: number) => {
      const response = await readFrame();
      if (response.command !== command || response.payload[0] !== status) throw new Error('R2P2 が転送を拒否しました');
      return response.payload;
    };
    try {
      await writer.write(Uint8Array.of(3));
      await pause(100);
      await writer.write(Uint8Array.of(2));
      const deadline = Date.now() + TIMEOUT_MS;
      while ((await readExact(1, deadline))[0] !== 0x06) {}

      const content = new TextEncoder().encode(source);
      const path = new TextEncoder().encode('/home/main.rb');
      const metadata = new Uint8Array(4 + path.length);
      new DataView(metadata.buffer).setUint32(0, content.length);
      metadata.set(path, 4);
      await writer.write(frame(FILE_WRITE, metadata));
      await expect(FILE_ACK, READY);
      for (let offset = 0; offset < content.length; offset += CHUNK_SIZE) {
        await writer.write(frame(CHUNK, content.slice(offset, offset + CHUNK_SIZE)));
        await expect(CHUNK_ACK, 0);
      }
      const done = await expect(DONE_ACK, 0);
      if (done.length !== 5 || new DataView(done.buffer, done.byteOffset).getUint32(1) !== crc32(content)) {
        throw new Error('R2P2 に書き込んだmain.rbのCRCが一致しません');
      }
      await pause(250);
      await writer.write(new TextEncoder().encode('/home/main.rb\r\n'));
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      writer.releaseLock();
    }
  } finally {
    await port.close();
  }
};
