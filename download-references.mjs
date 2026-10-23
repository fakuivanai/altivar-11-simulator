// Original reference downloader. Official URLs, byte counts and hashes are in the manifest.
// A response is saved only after its complete contents match the recorded manufacturer PDF.
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const expectedNames = new Set(['Manual del fabricante.pdf', 'Referencia del fabricante.pdf']);

function matches(contents, reference) {
  return contents.length === reference.bytes && contents.subarray(0, 5).toString() === '%PDF-' &&
    createHash('sha256').update(contents).digest('hex') === reference.sha256;
}

async function existingFile(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateManifest(references) {
  if (!Array.isArray(references) || references.length !== 2 ||
      new Set(references.map(reference => reference.filename)).size !== 2)
    throw new Error('El manifiesto debe contener los dos documentos originales.');
  for (const reference of references) {
    if (!expectedNames.has(reference.filename) || reference.unmodified !== true ||
        !Number.isSafeInteger(reference.bytes) || reference.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(reference.sha256))
      throw new Error('Metadatos de referencia inválidos.');
    const url = new URL(reference.sourceUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'se.my.site.com' ||
        !url.pathname.startsWith('/ckmContent/sfc/servlet.shepherd/document/download/'))
      throw new Error('La referencia debe usar la descarga oficial del fabricante.');
  }
}

export async function downloadReferences({directory = root, fetcher = fetch} = {}) {
  const references = JSON.parse(await readFile(path.join(directory, 'manufacturer-documents.json'), 'utf8'));
  validateManifest(references);
  const results = [];
  for (const reference of references) {
    const filename = path.join(directory, reference.filename);
    const existing = await existingFile(filename);
    if (existing && matches(existing, reference)) {
      results.push({filename: reference.filename, downloaded: false, verified: true});
      continue;
    }
    const response = await fetcher(reference.sourceUrl, {signal: AbortSignal.timeout(60000)});
    if (!response.ok || !response.body)
      throw new Error(reference.filename + ': descarga no disponible, HTTP ' + response.status);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > reference.bytes)
        throw new Error(reference.filename + ': la descarga supera el tamaño registrado.');
      chunks.push(buffer);
    }
    const contents = Buffer.concat(chunks);
    if (!matches(contents, reference))
      throw new Error(reference.filename + ': el tamaño, la cabecera PDF o el SHA256 no coinciden.');
    const temporary = path.join(directory, '.' + reference.filename + '.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, contents, {flag: 'wx'});
      await rename(temporary, filename);
    } finally {
      try {
        await unlink(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    results.push({filename: reference.filename, downloaded: true, verified: true});
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const result of await downloadReferences())
      console.log((result.downloaded ? 'Descargado y verificado: ' : 'Verificado: ') + result.filename);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
