import assert from 'node:assert/strict';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

function nodes(root: Node): Node[] {
  const children = 'childNodes' in root ? root.childNodes.flatMap(nodes) : [];
  return [root, ...children];
}
function attr(element: Element, key: string): string | undefined {
  return element.attrs.find(item => item.name === key)?.value;
}
function text(node: Node): string {
  return 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';
}

/** Validate generated files before they become deployable artifacts. */
export function checkPages(files: ReadonlyMap<string, string>, officialUrls: readonly string[]): void {
  const allowedDocuments = new Set(officialUrls);
  const applicationScripts: string[] = [];
  for (const [name, html] of files) {
    const elements = nodes(parse(html)).filter((node): node is Element => 'tagName' in node);
    const ids = elements.flatMap(element => attr(element, 'id') ?? []);
    assert.equal(ids.length, new Set(ids).size, name + ': duplicate HTML identifiers');
    const localLink = (href: string): void => {
      const url = new URL(href, 'https://build.invalid/' + encodeURIComponent(name));
      if (url.origin !== 'https://build.invalid') {
        const document = new URL(url); document.hash = '';
        assert.ok(allowedDocuments.has(document.href), name + ': undocumented external link');
        return;
      }
      assert.ok(!href.startsWith('/'), name + ': root-relative link breaks project hosting');
      const target = decodeURIComponent(url.pathname.slice(1));
      assert.ok(files.has(target), name + ': broken link ' + href);
      if (url.hash && target === name) assert.ok(ids.includes(decodeURIComponent(url.hash.slice(1))), name + ': missing anchor');
    };
    for (const element of elements) {
      const tag = element.tagName;
      assert.ok(tag !== 'base' && tag !== 'link', name + ': separate resource or changed URL base');
      for (const key of ['src', 'srcset', 'poster', 'data']) {
        const value = attr(element, key);
        if (value !== undefined) assert.ok(value.startsWith('data:'), name + ': external runtime asset');
      }
      if (tag === 'a') { const href = attr(element, 'href'); if (href) localLink(href); }
      if (tag === 'meta' && attr(element, 'http-equiv')?.toLowerCase() === 'refresh') {
        const match = /^0;url=(.+)$/.exec(attr(element, 'content') ?? '');
        assert.ok(match, name + ': malformed compatibility redirect'); localLink(match[1]!);
      }
      if (tag === 'style') {
        const css = text(element);
        assert.doesNotMatch(css, /@import\b/i, name + ': external stylesheet');
        for (const match of css.matchAll(/url\(\s*['"]?([^)'"]+)/gi))
          assert.match(match[1]!, /^(data:|#)/, name + ': external CSS asset');
      }
    }
    assert.doesNotMatch(html, /\/home\/|\/Users\/|[A-Z]:\\Users\\|scratch-workspaces/, name + ': machine-specific path');
    assert.doesNotMatch(html, /[\u2014\u2013\u2026\u00b7\u00b2]/u, name + ': unsupported classroom character');
    const scripts = elements.filter(element => element.tagName === 'script');
    if (name.startsWith('Simulador de variador')) {
      assert.equal(scripts.length, 1, name + ': expected one bundled script');
      assert.equal(attr(scripts[0]!, 'id'), 'application');
      assert.equal(attr(scripts[0]!, 'src'), undefined);
      assert.ok(['', 'text/javascript', 'application/javascript'].includes(attr(scripts[0]!, 'type') ?? ''), name + ': script must run as classic JavaScript');
      const bundle = text(scripts[0]!);
      const executable = bundle.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').replace(/^['"]use strict['"];?\s*/, '');
      assert.match(executable, /^\(\(\)\s*=>\s*\{/, name + ': application must be an IIFE');
      assert.match(executable, /\}\)\(\);?\s*$/, name + ': application IIFE must invoke itself');
      assert.doesNotMatch(bundle, /^\s*(?:import|export)\s|\bimport\s*\(/m, name + ': unbundled JavaScript');
      assert.ok(bundle.includes('VFDSimulator'), name + ': missing public simulator API');
      assert.ok(bundle.includes('MIT License'), name + ': missing runtime license');
      for (const url of officialUrls) assert.ok(bundle.includes(url), name + ': missing manufacturer reference');
      applicationScripts.push(bundle);
    } else assert.equal(scripts.length, 0, name + ': unexpected script');
  }
  assert.equal(applicationScripts.length, 2);
  assert.equal(applicationScripts[0], applicationScripts[1], 'Projection and study pages must run the same code');
}
