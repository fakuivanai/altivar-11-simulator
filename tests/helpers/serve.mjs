import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const prefix = '/classroom/drive-simulator/';
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) throw Error('Not found');
    const file = resolve(dist, pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(resolve(dist) + sep)) throw Error('Not found');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('Not found');
  }
}).listen(Number(process.env.VFD_TEST_PORT || 4173), '127.0.0.1');
