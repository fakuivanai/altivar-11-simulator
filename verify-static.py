# Original checks for the offline simulator and intact manufacturer references.
from collections import Counter
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import math
import re

ROOT = Path(__file__).resolve().parent
FORBIDDEN_CHARACTERS = ('\u2014', '\u2013', '\u2026', '\u00b7', '\u00b2')


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.links = []
        self.refreshes = []
        self.scripts = []
        self.styles = []
        self.active_script = None
        self.active_style = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if 'id' in attributes:
            self.ids.append(attributes['id'])
        for key, value in attrs:
            if value is not None and key != 'xmlns':
                assert not re.search(r'(?:https?:)?//', value), 'Remote URL in HTML attribute: ' + key
        for key in ('src', 'srcset', 'poster', 'data'):
            if key in attributes and tag in ('script', 'img', 'iframe', 'source', 'video', 'audio', 'object', 'embed'):
                assert attributes[key].startswith('data:'), 'Separate runtime asset: ' + tag
        if tag == 'link':
            raise AssertionError('Separate link resource in standalone HTML')
        if tag == 'base':
            raise AssertionError('A base URL changes local-file resolution')
        if tag == 'a' and 'href' in attributes:
            self.links.append(attributes['href'])
        if tag == 'meta' and attributes.get('http-equiv', '').lower() == 'refresh':
            match = re.search(r'\burl\s*=\s*(.*)', attributes.get('content', ''), re.IGNORECASE)
            assert match, 'Refresh without a destination'
            self.refreshes.append(match[1].strip().strip('"\''))
        if tag == 'script':
            assert 'src' not in attributes, 'Application script must be inline'
            assert attributes.get('type', '') in ('', 'text/javascript', 'application/javascript'), 'Module script requires a different loading contract'
            self.active_script = {'attributes': attributes, 'text': ''}
            self.scripts.append(self.active_script)
        if tag == 'style':
            self.active_style = []
            self.styles.append(self.active_style)

    def handle_data(self, data):
        if self.active_script is not None:
            self.active_script['text'] += data
        if self.active_style is not None:
            self.active_style.append(data)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.active_script = None
        if tag == 'style':
            self.active_style = None


def parse_page(name):
    text = (ROOT / name).read_text()
    page = Page()
    page.feed(text)
    assert len(page.ids) == len(set(page.ids)), name + ': duplicate identifiers'
    for href in page.links + page.refreshes:
        parsed = urlsplit(href)
        assert not parsed.scheme and not parsed.netloc, name + ': nonlocal link ' + href
        if not parsed.path:
            assert parsed.fragment in page.ids, name + ': broken internal link ' + href
        else:
            assert (ROOT / unquote(parsed.path)).is_file(), name + ': broken file link ' + href
    for parts in page.styles:
        style = ''.join(parts)
        assert not re.search(r'@import\b', style, re.IGNORECASE), name + ': stylesheet import'
        for match in re.finditer(r'url\(\s*([^)]+)\s*\)', style, re.IGNORECASE):
            target = match[1].strip().strip('"\'')
            assert target.startswith(('data:', '#')), name + ': separate CSS asset'
    assert not any(character in text for character in FORBIDDEN_CHARACTERS), name + ': unsupported classroom character'
    return page


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


manifest = json.loads((ROOT / 'manufacturer-documents.json').read_text())
expected_files = {'Manual del fabricante.pdf', 'Referencia del fabricante.pdf'}
assert len(manifest) == 2 and {item['filename'] for item in manifest} == expected_files
for item in manifest:
    contents = (ROOT / item['filename']).read_bytes()
    assert contents.startswith(b'%PDF-'), item['filename'] + ': not a PDF'
    assert len(contents) == item['bytes'], item['filename'] + ': size mismatch'
    assert sha256(contents).hexdigest() == item['sha256'], item['filename'] + ': hash mismatch'
    assert item['unmodified'] is True
    assert urlsplit(item['sourceUrl']).scheme == 'https'
    assert urlsplit(item['sourceUrl']).hostname == 'se.my.site.com'
    print('PASS intact manufacturer PDF: ' + item['filename'])

simulator = parse_page('Simulador de variador.html')
guide_page = parse_page('Simulador de variador, guía de estudio.html')
assert guide_page.scripts[0]['text'] == simulator.scripts[0]['text'], 'Both pages must run the same bundle'
assert len(simulator.scripts) == 1 and simulator.scripts[0]['attributes'].get('id') == 'application'
bundle = simulator.scripts[0]['text'].strip()
while bundle.startswith('/*'):
    end = bundle.find('*/')
    assert end >= 0, 'Unclosed leading script comment'
    bundle = bundle[end + 2:].lstrip()
directive = re.match(r'(["\'])use strict\1\s*;\s*', bundle)
if directive:
    bundle = bundle[directive.end():]
assert re.match(r'\(\s*\(\s*\)\s*=>\s*\{', bundle), 'Application must be an inline IIFE'
assert re.search(r'\}\s*\)\s*\(\s*\)\s*;\s*$', bundle), 'Application IIFE must invoke itself'
assert not re.search(r'^\s*(?:import|export)\s|\bimport\s*\(', bundle, re.MULTILINE), 'Unbundled module dependency'
assert '/*BUNDLE*/' not in bundle, 'Build placeholder is still present'
# The page is rendered by Solid, so the header link lives in the compiled templates.
assert 'href="Manual del fabricante.pdf#page=53"' in bundle, 'Header must link directly to the Spanish manufacturer guide'
print('PASS inline IIFE and local manufacturer link: Simulador de variador.html')

for name in ('manual.html', 'Manual del simulador de variador.html'):
    stub = parse_page(name)
    assert stub.refreshes == ['Manual del fabricante.pdf#page=53'], name + ': incorrect PDF redirect'
    assert expected_files.issubset({unquote(urlsplit(href).path) for href in stub.links}), name + ': missing original document link'
    assert not stub.scripts and 'catalog' not in stub.ids and 'consulta' not in stub.ids, name + ': generated parameter manual remains'
assert (ROOT / 'manual.html').read_bytes() == (ROOT / 'Manual del simulador de variador.html').read_bytes(), 'Published compatibility stub differs from its source'
print('PASS compatibility stub links the two original PDFs')

catalog = json.loads((ROOT / 'catalog-final.json').read_text())
ids = [item['id'] for item in catalog]
assert len(catalog) == 82 and Counter(ids).most_common(1)[0][1] == 1
settings = [item for item in catalog if item.get('readonly') is not True]
monitors = [item for item in catalog if item.get('readonly') is True]
assert len(settings) == 74 and len(monitors) == 8
types = (ROOT / 'parameter-types.ts').read_text()
parameter_array = re.search(r'export const PARAMETER_IDS\s*=\s*\[(.*?)\]', types, re.DOTALL)
monitor_array = re.search(r'export const MONITORS\s*=\s*\[(.*?)\]', types, re.DOTALL)
assert parameter_array and monitor_array
assert set(re.findall(r'"([^"]+)"', parameter_array[1])) == {item['id'] for item in settings}
assert {'SUP.' + code for code in re.findall(r'"([^"]+)"', monitor_array[1])} == {item['id'] for item in monitors}
for item in catalog:
    assert item['id'] == '.'.join(item['path'] + [item['code']]), item['id'] + ': inconsistent menu route'
    assert isinstance(item['label'], str) and item['label'].strip()
    assert item['source']['manual'] in ('user', 'technical')
    pages = range(18, 34) if item['source']['manual'] == 'user' else range(64, 125)
    assert item['source']['page'] in pages, item['id'] + ': invalid source page'
    assert json.dumps(item['id']) in bundle, item['id'] + ': missing from the compiled bundle'
    if item.get('readonly') is True:
        assert item['path'] == ['SUP'] and 'default' not in item
    elif 'choices' in item:
        assert item['choices'] and item['default'] in item['choices'], item['id'] + ': invalid initial choice'
        assert isinstance(item['runEditable'], bool)
    else:
        assert all(number(item[key]) for key in ('min', 'max', 'step', 'default'))
        assert item['min'] <= item['default'] <= item['max'] and item['step'] > 0
        assert isinstance(item['runEditable'], bool)
print('PASS 74 settings and 8 monitors independently match the typed registry, bundle and source pages')
