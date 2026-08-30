interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}

interface SerialNavigator extends Navigator {
  serial?: { requestPort(): Promise<SerialPort> };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const webSerialAvailable = (): boolean => Boolean((navigator as SerialNavigator).serial);

export const transferToR2P2 = async (source: string): Promise<void> => {
  const serial = (navigator as SerialNavigator).serial;
  if (!serial) throw new Error('Web Serial は Chrome / Edge でのみ利用できます');
  const portPromise = serial.requestPort();
  const port = await portPromise;
  await port.open({ baudRate: 115200 });
  if (!port.writable) throw new Error('シリアルポートに書き込めません');
  const writer = port.writable.getWriter();
  const encode = new TextEncoder();
  const delimiter = `PICOSIM_EOF_${crypto.randomUUID().replaceAll('-', '')}`;
  try {
    await writer.write(new Uint8Array([3]));
    await pause(100);
    await writer.write(encode.encode(`cat > main.rb << '${delimiter}'\r\n`));
    await writer.write(encode.encode(source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')));
    await writer.write(encode.encode(`\r\n${delimiter}\r\nruby main.rb\r\n`));
  } finally {
    writer.releaseLock();
  }
};
