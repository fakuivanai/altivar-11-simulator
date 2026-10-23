// Transform TypeScript directly in memory; tests never consume generated modules.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL) {
    const candidate = new URL(specifier, context.parentURL);
    if (!/\.[a-z]+$/i.test(candidate.pathname)) {
      for (const extension of ['.ts', '.tsx', '.mjs']) {
        const expanded = new URL(candidate.href + extension);
        try {
          if ((await stat(expanded)).isFile()) return {
            url: expanded.href,
            shortCircuit: true
          };
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.ts$/.test(new URL(url).pathname)) {
    const result = await transform(await readFile(new URL(url), 'utf8'), {
      loader: 'ts',
      format: 'esm',
      target: 'node24',
      sourcefile: fileURLToPath(url),
      sourcemap: 'inline'
    });
    return {
      format: 'module',
      source: result.code,
      shortCircuit: true
    };
  }
  if (url.startsWith('file:') && url.endsWith('.json')) {
    return {
      format: 'module',
      source: 'export default ' + (await readFile(new URL(url), 'utf8')) + ';',
      shortCircuit: true
    };
  }
  return nextLoad(url, context);
}
