import { afterEach, describe, expect, it, vi } from 'vitest';
import { transferToR2P2, webSerialAvailable } from './transfer';

describe('Web Serial transfer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes a CRLF heredoc and always closes the port', async () => {
    const chunks: Uint8Array[] = [];
    const port = {
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      writable: new WritableStream<Uint8Array>({ write: (chunk) => { chunks.push(chunk); } }),
    };
    vi.stubGlobal('navigator', { serial: { requestPort: vi.fn(async () => port) } });

    expect(webSerialAvailable()).toBe(true);
    await transferToR2P2("puts 'a'\nputs 'b'");

    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(port.close).toHaveBeenCalledOnce();
    expect([...chunks[0]]).toEqual([3]);
    const output = new TextDecoder().decode(Uint8Array.from(chunks.slice(1).flatMap((chunk) => [...chunk])));
    const delimiter = output.match(/PICOSIM_EOF_[a-f0-9]+/)?.[0];
    expect(delimiter).toBeTruthy();
    expect(output).toBe(`cat > main.rb << '${delimiter}'\r\nputs 'a'\r\nputs 'b'\r\n${delimiter}\r\nruby main.rb\r\n`);
  });

  it('closes a port with no writable stream', async () => {
    const port = { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined), writable: null };
    vi.stubGlobal('navigator', { serial: { requestPort: vi.fn(async () => port) } });
    await expect(transferToR2P2('')).rejects.toThrow('書き込めません');
    expect(port.close).toHaveBeenCalledOnce();
  });
});
