// Original geometry audit for the TSX stage. This function is serialized into
// either browser; circuit identities come from the drawing's data-net and active
// data-connects attributes, never from a coincident dot or endpoint alone.
export function auditStage() {
  const stage = document.getElementById('stage');
  const svg = document.getElementById('schematic');
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
    return {
      ok: false,
      problems: ['stage or schematic missing'],
      counts: {
        wires: 0,
        placed: 0
      }
    };
  }
  const bounds = stage.getBoundingClientRect();
  const scale = bounds.width / 1600;
  const visible = element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  };
  const parent = new Map();
  const root = net => {
    if (!parent.has(net)) parent.set(net, net);
    let current = net;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  for (const element of svg.querySelectorAll('[data-connects]')) {
    if (!visible(element)) continue;
    const nets = element.getAttribute('data-connects').trim().split(/\s+/).filter(Boolean);
    for (const net of nets.slice(1)) parent.set(root(net), root(nets[0]));
  }
  const point = (x, y, matrix) => ({
    x: (matrix.a * x + matrix.c * y + matrix.e - bounds.left) / scale,
    y: (matrix.b * x + matrix.d * y + matrix.f - bounds.top) / scale
  });
  const problems = [],
    segments = [],
    unannotated = [];
  let wireCount = 0;
  for (const path of svg.querySelectorAll('.wires path, path.wire, .short path, path[data-net]')) {
    if (!visible(path) || /mechanical|push|arrow/.test(path.getAttribute('class') || '') || !path.getAttribute('d')) continue;
    const netElement = path.closest('[data-net]');
    const net = netElement?.getAttribute('data-net');
    const label = path.id || 'path ' + wireCount;
    wireCount += 1;
    if (!net) {
      unannotated.push(label);
      continue;
    }
    const matrix = path.getScreenCTM();
    if (!matrix) {
      problems.push('missing path transform: ' + label);
      continue;
    }
    const tokens = path.getAttribute('d').match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
    let index = 0,
      command = '',
      x = 0,
      y = 0,
      startX = 0,
      startY = 0;
    while (index < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[index])) command = tokens[index++];
      if (!['M', 'L', 'H', 'V', 'Z'].includes(command)) {
        problems.push('unsupported wire path command: ' + label);
        break;
      }
      const number = () => Number(tokens[index++]);
      if (command === 'M') {
        x = startX = number();
        y = startY = number();
        command = 'L';
        continue;
      }
      let nextX = x,
        nextY = y;
      if (command === 'L') {
        nextX = number();
        nextY = number();
      }
      if (command === 'H') nextX = number();
      if (command === 'V') nextY = number();
      if (command === 'Z') {
        nextX = startX;
        nextY = startY;
        command = '';
      }
      if (![x, y, nextX, nextY].every(Number.isFinite)) {
        problems.push('invalid wire coordinates: ' + label);
        break;
      }
      const a = point(x, y, matrix),
        b = point(nextX, nextY, matrix);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.01) segments.push({
        a,
        b,
        net: root(net),
        label,
        path
      });
      x = nextX;
      y = nextY;
    }
  }
  if (unannotated.length) problems.push('unannotated conductors: ' + unannotated.join(', '));
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const delta = (a, b) => ({
    x: a.x - b.x,
    y: a.y - b.y
  });
  const intersections = (first, second) => {
    const r = delta(first.b, first.a),
      s = delta(second.b, second.a),
      offset = delta(second.a, first.a);
    const denominator = cross(r, s),
      tolerance = 0.05;
    if (Math.abs(denominator) < 1e-8) {
      if (Math.abs(cross(offset, r)) > tolerance * Math.hypot(r.x, r.y)) return false;
      const axis = Math.abs(r.x) >= Math.abs(r.y) ? 'x' : 'y';
      return Math.min(Math.max(first.a[axis], first.b[axis]), Math.max(second.a[axis], second.b[axis])) >= Math.max(Math.min(first.a[axis], first.b[axis]), Math.min(second.a[axis], second.b[axis])) - tolerance;
    }
    const t = cross(offset, s) / denominator,
      u = cross(offset, r) / denominator;
    return t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6;
  };
  let netPairs = 0;
  for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
    const a = segments[i],
      b = segments[j];
    if (a.path === b.path || a.net === b.net) continue;
    netPairs += 1;
    if (intersections(a, b)) problems.push('different nets touch: ' + a.net + '/' + b.net + ' (' + a.label + ', ' + b.label + ')');
  }
  // Use rendered screen rectangles for rotated SVG labels and HTML text alike.
  // Small inset leaves room for antialiasing; labels intentionally clipped with
  // an ellipsis are checked against their visible containing rectangle.
  const textBoxes = [];
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode,
      element = node.parentElement;
    if (!node.textContent.trim() || !element || !visible(element) || element.closest('button.contact')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      const inset = 1 * scale;
      if (rect.width <= 2 * inset || rect.height <= 2 * inset) continue;
      let left = rect.left + inset,
        top = rect.top + inset,
        right = rect.right - inset,
        bottom = rect.bottom - inset;
      for (let ancestor = element; ancestor && ancestor !== stage; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.textOverflow !== 'ellipsis') continue;
        const clipped = ancestor.getBoundingClientRect();
        left = Math.max(left, clipped.left);
        right = Math.min(right, clipped.right);
        top = Math.max(top, clipped.top);
        bottom = Math.min(bottom, clipped.bottom);
      }
      if (left >= right || top >= bottom) continue;
      const rectangle = {
        left: (left - bounds.left) / scale,
        top: (top - bounds.top) / scale,
        right: (right - bounds.left) / scale,
        bottom: (bottom - bounds.top) / scale,
        text: node.textContent.trim().slice(0, 80),
        node
      };
      textBoxes.push(rectangle);
      if (rectangle.left < -0.5 || rectangle.top < -0.5 || rectangle.right > 1600.5 || rectangle.bottom > 900.5) {
        problems.push('text outside stage: ' + rectangle.text);
      }
      if (!element.closest('svg')) {
        const container = element.closest('.placed');
        if (container) {
          const placed = container.getBoundingClientRect();
          if (left < placed.left - scale || right > placed.right + scale || top < placed.top - scale || bottom > placed.bottom + scale) {
            problems.push('text spills outside control: ' + container.id + ' / ' + rectangle.text);
          }
        }
      }
    }
  }
  for (let i = 0; i < textBoxes.length; i += 1) for (let j = i + 1; j < textBoxes.length; j += 1) {
    const a = textBoxes[i],
      b = textBoxes[j];
    if (a.node === b.node) continue;
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) problems.push('text overlaps: ' + a.text + ' / ' + b.text);
  }
  const throughRectangle = (segment, rectangle) => {
    const dx = segment.b.x - segment.a.x,
      dy = segment.b.y - segment.a.y;
    let low = 0,
      high = 1;
    for (const [p, q] of [[-dx, segment.a.x - rectangle.left], [dx, rectangle.right - segment.a.x], [-dy, segment.a.y - rectangle.top], [dy, rectangle.bottom - segment.a.y]]) {
      if (Math.abs(p) < 1e-9) {
        if (q < 0) return false;
        continue;
      }
      const at = q / p;
      if (p < 0) low = Math.max(low, at);else high = Math.min(high, at);
      if (low > high) return false;
    }
    return true;
  };
  for (const segment of segments) for (const rectangle of textBoxes) {
    if (throughRectangle(segment, rectangle)) problems.push('wire through text: ' + segment.label + ' / ' + rectangle.text);
  }
  const placed = [...stage.querySelectorAll('.placed')].filter(visible).map(element => {
    const rect = element.getBoundingClientRect();
    return {
      id: element.id,
      left: (rect.left - bounds.left) / scale,
      top: (rect.top - bounds.top) / scale,
      right: (rect.right - bounds.left) / scale,
      bottom: (rect.bottom - bounds.top) / scale
    };
  });
  for (const rectangle of placed) if (rectangle.left < -0.5 || rectangle.top < -0.5 || rectangle.right > 1600.5 || rectangle.bottom > 900.5) {
    problems.push('outside stage: ' + rectangle.id);
  }
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) {
    const a = placed[i],
      b = placed[j];
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) problems.push('controls overlap: ' + a.id + '/' + b.id);
  }
  const clipped = [];
  for (const element of stage.querySelectorAll('.placed, #settings *, #readings *')) {
    if (!visible(element) || ['INPUT', 'SELECT', 'CANVAS', 'SVG'].includes(element.tagName)) continue;
    const style = getComputedStyle(element);
    if (style.textOverflow === 'ellipsis') continue;
    if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible') clipped.push(element.id || element.className);
    if (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1 && style.overflowY !== 'visible') clipped.push(element.id || element.className);
  }
  if (clipped.length) problems.push('clipped content: ' + clipped.join(', '));
  const documentBounds = document.documentElement;
  if (documentBounds.scrollWidth > innerWidth + 1 || documentBounds.scrollHeight > innerHeight + 1) problems.push('page scrolls');
  return {
    ok: problems.length === 0,
    problems: [...new Set(problems)],
    counts: {
      wires: wireCount,
      segments: segments.length,
      textBoxes: textBoxes.length,
      placed: placed.length,
      netPairs,
      unannotated: unannotated.length
    },
    stage: {
      width: bounds.width,
      height: bounds.height,
      scale
    }
  };
}
