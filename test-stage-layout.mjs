// Original controlled browser cases for the serialized stage geometry audit.
// Uses the same optional Playwright/Chromium environment as qa-chromium.mjs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {auditStage} from './qa-stage-layout.mjs';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage']});
const page = await browser.newPage({viewport: {width: 1600, height: 900}});
const wire = (net, d, extra = '') => `<path data-net="${net}" d="${d}" ${extra}/>`;
const cases = [
  ['parallel distinct nets', wire('U', 'M10 10 H100') + wire('V', 'M10 20 H100'), true],
  ['different nets cross', wire('U', 'M10 10 H100') + wire('V', 'M50 0 V30'), false, 'different nets touch'],
  ['different endpoints touch', wire('U', 'M10 10 H50') + wire('V', 'M50 10 V50'), false, 'different nets touch'],
  ['different nets overlap', wire('U', 'M10 10 H100') + wire('V', 'M50 10 H110'), false, 'different nets touch'],
  ['series join on same net', wire('U', 'M10 10 H50') + wire('U', 'M50 10 V50'), true],
  ['dot cannot join different nets', wire('U', 'M10 10 H100') + wire('V', 'M50 0 V30') + '<circle cx="50" cy="10" r="3"/>', false, 'different nets touch'],
  ['closed contact explicitly joins nets', wire('U', 'M10 10 H50') + wire('V', 'M50 10 V50', 'data-connects="U V"'), true],
  ['hidden short never joins nets', wire('U', 'M10 10 H100') + wire('V', 'M50 0 V30') + '<g visibility="hidden">' + wire('U', 'M50 10 H100', 'data-connects="U V"') + '</g>', false, 'different nets touch'],
  ['missing circuit identity is rejected', '<path d="M10 10 H100"/>', false, 'unannotated conductors'],
  ['wire crosses transformed label', wire('U', 'M10 50 H150') + '<text x="0" y="0" transform="translate(50 60) rotate(-90)">Label</text>', false, 'wire through text'],
  ['unclipped text outside placed box is rejected', '', false, 'text spills outside control', '<div id="small" class="placed" style="left:10px;top:100px;width:10px;height:20px;white-space:nowrap">Long text</div>'],
  ['intentional ellipsis is permitted', '', true, '', '<div id="ellipsis" class="placed" style="left:10px;top:100px;width:10px;height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Long text</div>'],
  ['overlapping labels are rejected', '', false, 'text overlaps', '<span style="position:absolute;left:10px;top:100px">Label A</span><span style="position:absolute;left:20px;top:100px">Label B</span>'],
];
try {
  for (const [name, drawing, valid, reason, html = ''] of cases) {
    await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;overflow:hidden}#stage{width:1600px;height:900px;position:absolute}.placed{position:absolute}svg{position:absolute;width:1600px;height:900px}path{fill:none;stroke:#333}text{font:18px Arial}</style><div id="stage"><svg id="schematic" viewBox="0 0 1600 900"><g class="wires">${drawing}</g></svg>${html}</div>`);
    const result = await page.evaluate(auditStage);
    assert.equal(result.ok, valid, name + ': ' + JSON.stringify(result.problems));
    if (reason) assert.ok(result.problems.some(problem => problem.includes(reason)), name + ': ' + JSON.stringify(result.problems));
    console.log('PASS', name);
  }
} finally { await browser.close(); }
console.log(cases.length + ' controlled stage-audit cases passed');
