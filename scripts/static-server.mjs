import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const port = Number(process.env.PORT ?? 4180);
const files = new Map();
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.yml': 'text/yaml' };

const load = async (directory = '') => {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const name = join(directory, entry.name);
    if (entry.isDirectory()) await load(name);
    else {
      const raw = await readFile(join(root, name));
      files.set(`/${name}`, { raw, gzip: gzipSync(raw, { level: 6 }) });
    }
  }
};

await load();
createServer((request, response) => {
  const requested = new URL(request.url, 'http://localhost').pathname;
  const path = requested === '/' ? '/index.html' : requested;
  const file = files.get(path);
  if (!file) return void response.writeHead(404).end();
  const gzip = request.headers['accept-encoding']?.includes('gzip');
  const body = gzip ? file.gzip : file.raw;
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': types[extname(path)] ?? 'application/octet-stream',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    Vary: 'Accept-Encoding',
  });
  response.end(body);
}).listen(port, '127.0.0.1', () => console.log(`gzip dist: http://127.0.0.1:${port}`));
