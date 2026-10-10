/**
 * CSS-in-JS extractor — stylespeak v1.3
 *
 * Statically extracts styles from styled-components and Emotion source files
 * (zero external dependencies, regex + balanced-scanner based) and converts
 * them into the same rule shape cssParser.js produces, so every stylespeak
 * tool (resolve_styles, trace_property, impact_preview, style_manifest)
 * works on them without changes to the cascade engine.
 *
 * Supported:
 *   - Tagged templates:   styled.div`...`, styled(Comp)`...`, styled.div.attrs(...)`...`,
 *                         styled.div<Props>`...`, css`...`, createGlobalStyle`...`
 *   - Object syntax:      styled.div({ ... }), styled(Comp)({ ... }), css({ ... }),
 *                         styled.div(props => ({ ... }))
 *   - Nesting:            &, &&, &:hover, nested selectors, @media / @supports / @container
 *   - Interpolations:     same-file constants (`${SPACING}`, `${colors.primary}`) are resolved,
 *                         component selectors (`${Icon} { ... }`) become `.Icon`,
 *                         same-file css helpers (`${flexCenter}`, `...flexCenter`) are inlined
 *   - Object notation:    camelCase -> kebab-case, vendor prefixes, unitless numbers -> px
 *
 * Because generated class names are hashed at runtime, every styled component
 * is addressed by a synthetic class selector equal to its variable name:
 *   const Button = styled.button`...`   ->   `.Button`
 * Rules are tagged with cssInJs / library / component metadata and treated as
 * locally scoped (like CSS Modules) — two components named `Wrapper` in different
 * files do not conflict at runtime.
 *
 * NOT statically resolvable (recorded, never guessed):
 *   - Prop/theme-dependent values:  `${props => props.color}`  -> declaration flagged `dynamic: true`
 *   - Conditional blocks:           `${p => p.active && css`...`}` -> counted in dynamicInterpolations
 *   - Constants imported from other files
 *   - Emotion `css` prop on JSX elements (anonymous — nothing to target by selector)
 *   - keyframes, theme functions, styled(Base) inheritance (recorded as `extends`, not merged)
 */

const path = require('path');
const { expandSCSS } = require('./scssNestingExpander');
const { parseCSS } = require('./cssParser');

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

const LIBRARY_PATTERNS = [
  { library: 'styled-components', re: /(?:from\s*|require\(\s*|import\s*\(\s*)['"]styled-components(?:\/[\w-]+)?['"]/ },
  { library: 'emotion', re: /(?:from\s*|require\(\s*|import\s*\(\s*)['"]@emotion\/(?:styled|react|css|core)(?:\/[\w-]+)?['"]/ },
];

function isCssInJsFile(filePath) {
  return JS_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

function detectLibrary(source) {
  for (const { library, re } of LIBRARY_PATTERNS) {
    if (re.test(source)) return library;
  }
  return null;
}

// ─── Low-level scanners ──────────────────────────────────────────────────────

function skipLineComment(src, i) {
  const e = src.indexOf('\n', i);
  return e === -1 ? src.length : e;
}

function skipBlockComment(src, i) {
  const e = src.indexOf('*/', i + 2);
  return e === -1 ? src.length : e + 2;
}

function skipString(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q) return i + 1;
    if (src[i] === '\n') return i + 1; // unterminated — bail out
    i++;
  }
  return i;
}

function skipTemplate(src, i) {
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') { i = skipBalanced(src, i + 1, '{', '}'); continue; }
    i++;
  }
  return i;
}

/** src[i] must be `open`. Returns the index just after the matching `close`. */
function skipBalanced(src, i, open, close) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { i = skipString(src, i); continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return i;
}

/** Skips a TypeScript generic argument list <...>. src[i] must be '<'. */
function skipAngle(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { i = skipString(src, i); continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '<') depth++;
    else if (c === '>' && src[i - 1] !== '=') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return i;
}

function skipWs(src, i) {
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (src[i] === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    break;
  }
  return i;
}

/** Builds a fast index -> 1-based line number lookup (binary search over newline offsets). */
function makeLineLookup(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return function lineOf(index) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Heuristic: is `index` inside a '...' / "..." string literal on its own line? */
function insideStringOnLine(src, index) {
  const lineStart = src.lastIndexOf('\n', index - 1) + 1;
  let quote = null;
  for (let i = lineStart; i < index; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    }
  }
  return quote !== null;
}

/**
 * Parses a template literal starting at the opening backtick.
 * Returns { parts: [{t:'text',v} | {t:'expr',v}], end }.
 */
function parseTemplate(src, i) {
  const parts = [];
  let buf = '';
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === '\\' || n === '`' || n === '$') buf += n; else buf += c + (n || '');
      i += 2;
      continue;
    }
    if (c === '`') { parts.push({ t: 'text', v: buf }); return { parts, end: i + 1 }; }
    if (c === '$' && src[i + 1] === '{') {
      parts.push({ t: 'text', v: buf });
      buf = '';
      const e = skipBalanced(src, i + 1, '{', '}');
      parts.push({ t: 'expr', v: src.slice(i + 2, e - 1).trim() });
      i = e;
      continue;
    }
    buf += c;
    i++;
  }
  parts.push({ t: 'text', v: buf });
  return { parts, end: i };
}

// ─── Object literal parsing (Emotion / styled object syntax) ─────────────────

/** Scans to the next top-level ',' or '}' without consuming it. */
function scanExprEnd(src, i) {
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { i = skipString(src, i); continue; }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '(') { i = skipBalanced(src, i, '(', ')'); continue; }
    if (c === '[') { i = skipBalanced(src, i, '[', ']'); continue; }
    if (c === '{') { i = skipBalanced(src, i, '{', '}'); continue; }
    if (c === ',' || c === '}') return i;
    i++;
  }
  return i;
}

function cookString(s) {
  return s.replace(/\\(['"\\])/g, '$1');
}

function parseValue(src, i) {
  const c = src[i];
  if (c === '{') {
    const r = parseObject(src, i);
    return { node: r.node, end: r.end };
  }
  if (c === '"' || c === "'") {
    const e = skipString(src, i);
    const after = skipWs(src, e);
    if (after >= src.length || src[after] === ',' || src[after] === '}') {
      return { node: { kind: 'str', value: cookString(src.slice(i + 1, e - 1)) }, end: e };
    }
  }
  if (c === '`') {
    const e = skipTemplate(src, i);
    const body = src.slice(i + 1, e - 1);
    const after = skipWs(src, e);
    if (!body.includes('${') && (after >= src.length || src[after] === ',' || src[after] === '}')) {
      return { node: { kind: 'str', value: body }, end: e };
    }
  }
  const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i, i + 40));
  if (num) {
    const after = skipWs(src, i + num[0].length);
    if (after >= src.length || src[after] === ',' || src[after] === '}') {
      return { node: { kind: 'num', value: num[0] }, end: i + num[0].length };
    }
  }
  const e = scanExprEnd(src, i);
  return { node: { kind: 'dyn', expr: src.slice(i, e).trim() }, end: e };
}

/** src[i] must be '{'. Returns { node: {kind:'obj', entries}, end }. */
function parseObject(src, i) {
  const entries = [];
  i++;
  while (i < src.length) {
    i = skipWs(src, i);
    if (i >= src.length) break;
    const c = src[i];
    if (c === '}') { i++; break; }
    if (c === ',') { i++; continue; }

    if (src.startsWith('...', i)) {
      const e = scanExprEnd(src, i + 3);
      entries.push({ spread: true, expr: src.slice(i + 3, e).trim() });
      i = e;
      continue;
    }

    let key = null;
    let keyDyn = null;
    if (c === '"' || c === "'") {
      const e = skipString(src, i);
      key = src.slice(i + 1, e - 1);
      i = e;
    } else if (c === '[') {
      const e = skipBalanced(src, i, '[', ']');
      keyDyn = src.slice(i + 1, e - 1).trim();
      i = e;
    } else {
      const m = /^[\w$-]+/.exec(src.slice(i, i + 120));
      if (!m) { i++; continue; }
      key = m[0];
      i += key.length;
    }

    i = skipWs(src, i);
    if (src[i] === ':') {
      i = skipWs(src, i + 1);
      const v = parseValue(src, i);
      entries.push({ key, keyDyn, value: v.node });
      i = v.end;
    } else if (src[i] === '(') {
      // method shorthand — not statically evaluable
      const e = skipBalanced(src, i, '(', ')');
      let k = skipWs(src, e);
      if (src[k] === '{') k = skipBalanced(src, k, '{', '}');
      entries.push({ key, keyDyn, value: { kind: 'dyn', expr: String(key) + '()' } });
      i = k;
    } else {
      // shorthand property: { color }
      entries.push({ key, keyDyn, value: { kind: 'dyn', expr: String(key) } });
    }
  }
  return { node: { kind: 'obj', entries }, end: i };
}

// ─── Style head parsing: styled.div / styled(X) / css / createGlobalStyle ────

function parseHead(src, start) {
  let i = skipWs(src, start);
  const m = /^(styled|css|createGlobalStyle|keyframes|injectGlobal)(?![\w$])/.exec(src.slice(i, i + 24));
  if (!m) return null;
  const kind = m[1];
  i += kind.length;
  const head = { kind, tag: null, extendsName: null };

  if (kind === 'styled') {
    i = skipWs(src, i);
    if (src[i] === '.') {
      const t = /^\.([A-Za-z][\w]*)/.exec(src.slice(i, i + 40));
      if (!t) return null;
      head.tag = t[1];
      i += t[0].length;
    } else if (src[i] === '(') {
      const e = skipBalanced(src, i, '(', ')');
      const arg = src.slice(i + 1, e - 1).trim();
      if (/^['"][\w-]+['"]$/.test(arg)) head.tag = arg.slice(1, -1);
      else if (/^[A-Z][\w$]*$/.test(arg)) head.extendsName = arg;
      i = e;
    } else {
      return null;
    }
    // .attrs(...) / .withConfig(...) chains
    for (;;) {
      const j = skipWs(src, i);
      const c = /^\.(attrs|withConfig)/.exec(src.slice(j, j + 20));
      if (!c) break;
      let k = j + c[0].length;
      if (src[k] === '<') k = skipAngle(src, k);
      k = skipWs(src, k);
      if (src[k] !== '(') break;
      i = skipBalanced(src, k, '(', ')');
    }
  }

  let j = skipWs(src, i);
  if (src[j] === '<') j = skipWs(src, skipAngle(src, j));
  if (src[j] === '`') return { ...head, body: { type: 'template', index: j } };
  if (src[j] === '(' && (kind === 'styled' || kind === 'css')) return { ...head, body: { type: 'call', index: j } };
  return null;
}

/** Parses `( {...} )` or `( (props) => ({...}) )`. Returns { node, end } or null. */
function parseCallBody(src, idx) {
  const end = skipBalanced(src, idx, '(', ')');
  const i = skipWs(src, idx + 1);
  if (src[i] === '{') {
    const r = parseObject(src, i);
    return { node: r.node, end };
  }
  const arrow = /^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\(\s*\{/.exec(src.slice(i, i + 400));
  if (arrow) {
    const objStart = i + arrow[0].length - 1;
    const r = parseObject(src, objStart);
    return { node: r.node, end };
  }
  return { node: null, end };
}

// ─── Same-file constants (for interpolation resolution) ──────────────────────

function flattenObject(prefix, node, map) {
  for (const e of node.entries) {
    if (e.spread || e.key === null || e.keyDyn) continue;
    const p = prefix + '.' + e.key;
    if (e.value.kind === 'obj') flattenObject(p, e.value, map);
    else if (e.value.kind === 'str') map.set(p, String(e.value.value));
    else if (e.value.kind === 'num') { map.set(p, String(e.value.value)); map.numeric.add(p); }
  }
}

function collectConstants(src) {
  const map = new Map();
  map.numeric = new Set(); // names whose JS value is a number (Emotion/styled add px in object syntax)
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n;]+?)?\s*=\s*(?!=)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const i = skipWs(src, re.lastIndex);
    const rest = src.slice(i, i + 400);
    if (src[i] === '{') {
      const r = parseObject(src, i);
      flattenObject(name, r.node, map);
      continue;
    }
    const str = /^(['"])((?:\\.|(?!\1)[^\\\n])*)\1[ \t]*(?:as const)?[ \t]*(?=[;\n\r,]|$)/.exec(rest);
    if (str) { map.set(name, cookString(str[2])); continue; }
    const tpl = /^`([^`$]*)`[ \t]*(?:as const)?[ \t]*(?=[;\n\r,]|$)/.exec(rest);
    if (tpl) { map.set(name, tpl[1]); continue; }
    const num = /^(-?(?:\d+\.?\d*|\.\d+))[ \t]*(?:as const)?[ \t]*(?=[;\n\r,]|$)/.exec(rest);
    if (num) { map.set(name, num[1]); map.numeric.add(name); }
  }
  return map;
}

// ─── Conversion to pseudo-SCSS ───────────────────────────────────────────────

const UNITLESS = new Set([
  'animation-iteration-count', 'aspect-ratio', 'border-image-outset', 'border-image-slice', 'border-image-width',
  'box-flex', 'box-flex-group', 'box-ordinal-group', 'column-count', 'columns', 'flex', 'flex-grow', 'flex-positive',
  'flex-shrink', 'flex-negative', 'flex-order', 'font-weight', 'grid-area', 'grid-row', 'grid-row-end',
  'grid-row-span', 'grid-row-start', 'grid-column', 'grid-column-end', 'grid-column-span', 'grid-column-start',
  'line-clamp', 'line-height', 'opacity', 'order', 'orphans', 'scale', 'tab-size', 'widows', 'z-index', 'zoom',
  'fill-opacity', 'flood-opacity', 'stop-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-width',
]);

function toKebabCase(key) {
  if (key.startsWith('--')) return key;
  let out = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  if (/^ms-/.test(out)) out = '-' + out;
  return out;
}

function makeContext(constMap, helpers) {
  const ctx = {
    constMap,
    helpers,
    dyn: [],
    dropped: 0,
    depth: 0,
    ph(expr) {
      ctx.dyn.push(expr);
      return '__ssdyn' + (ctx.dyn.length - 1) + '__';
    },
  };
  return ctx;
}

function resolveLiteralOrConst(expr, ctx) {
  if (ctx.constMap.has(expr)) return ctx.constMap.get(expr);
  const s = /^(['"])((?:\\.|(?!\1)[^\\\n])*)\1$/.exec(expr);
  if (s) return cookString(s[2]);
  const t = /^`([^`$]*)`$/.exec(expr);
  if (t) return t[1];
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(expr)) return expr;
  return null;
}

function stripLineComments(text) {
  return text.replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1');
}

function findTerminator(parts, from) {
  for (let k = from; k < parts.length; k++) {
    if (parts[k].t !== 'text') continue;
    const m = /[;{}]/.exec(parts[k].v);
    if (m) return m[0];
  }
  return null;
}

function inlineHelper(helper, ctx) {
  if (ctx.depth >= 5) { ctx.dropped++; return ''; }
  ctx.depth++;
  const text = helper.node ? objectToScss(helper.node, ctx) : templateToScss(helper.parts, ctx);
  ctx.depth--;
  return text;
}

function templateToScss(parts, ctx) {
  let out = '';
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p.t === 'text') { out += stripLineComments(p.v); continue; }

    const expr = p.v;
    const lastBreak = Math.max(out.lastIndexOf(';'), out.lastIndexOf('{'), out.lastIndexOf('}'));
    const seg = out.slice(lastBreak + 1);
    const segBlank = seg.trim() === '';
    const term = findTerminator(parts, k + 1);
    const isIdent = /^[A-Za-z_$][\w$]*$/.test(expr);

    // css helper used as a mixin
    if (segBlank && isIdent && ctx.helpers.has(expr)) {
      out += inlineHelper(ctx.helpers.get(expr), ctx);
      continue;
    }
    // function / conditional interpolation at statement position — not evaluable
    if (segBlank && (/=>|^\(|^function\b/.test(expr))) { ctx.dropped++; continue; }
    // selector position: `${Icon} { ... }`, `&:hover ${Icon} { ... }`
    if (term === '{') {
      if (seg.trim().startsWith('@')) {
        const resolvedAt = resolveLiteralOrConst(expr, ctx);
        out += resolvedAt !== null ? resolvedAt : ctx.ph(expr);
      } else if (/^[A-Z][\w$]*$/.test(expr)) out += '.' + expr;
      else out += ctx.ph(expr);
      continue;
    }
    // standalone interpolation (mixin call, unresolved helper)
    if (segBlank) { ctx.dropped++; continue; }
    // value position
    const resolved = resolveLiteralOrConst(expr, ctx);
    out += resolved !== null ? resolved : ctx.ph(expr);
  }
  return out;
}

function normalizeNestedKey(key) {
  const k = key.trim();
  if (/^::?[A-Za-z-]/.test(k)) return '&' + k;
  return k;
}

function objectToScss(node, ctx) {
  let out = '';
  for (const e of node.entries) {
    if (e.spread) {
      const helper = ctx.helpers.get(e.expr);
      if (helper) out += inlineHelper(helper, ctx);
      else ctx.dropped++;
      continue;
    }
    if (e.keyDyn !== null && e.keyDyn !== undefined) { ctx.dropped++; continue; }
    if (e.value.kind === 'obj') {
      out += normalizeNestedKey(e.key) + ' {\n' + objectToScss(e.value, ctx) + '}\n';
      continue;
    }
    const prop = toKebabCase(e.key);
    let value;
    if (e.value.kind === 'str') {
      value = e.value.value;
    } else if (e.value.kind === 'num') {
      const n = e.value.value;
      value = (UNITLESS.has(prop) || prop.startsWith('--') || Number(n) === 0) ? n : n + 'px';
    } else {
      const resolved = resolveLiteralOrConst(e.value.expr, ctx);
      if (resolved === null) {
        value = ctx.ph(e.value.expr);
      } else if (ctx.constMap.numeric && ctx.constMap.numeric.has(e.value.expr) &&
                 !UNITLESS.has(prop) && !prop.startsWith('--') && Number(resolved) !== 0) {
        value = resolved + 'px';
      } else {
        value = resolved;
      }
    }
    out += prop + ': ' + value + ';\n';
  }
  return out;
}

/** styled-components / Emotion attach bare pseudo selectors (`:hover {`) to the parent. */
function attachLeadingPseudos(text) {
  return text.replace(
    /(^|[;{}])(\s*)((?:::?[A-Za-z-][\w-]*(?:\([^)]*\))?)+)(\s*(?:,|\{))/g,
    '$1$2&$3$4'
  );
}

// ─── Placeholder restoration ─────────────────────────────────────────────────

const PH_RE = /__ssdyn(\d+)__/g;

function restore(str, ctx) {
  let hit = false;
  const text = str.replace(PH_RE, (m, n) => {
    hit = true;
    return '${' + (ctx.dyn[Number(n)] || '?') + '}';
  });
  return { text, hit };
}

// ─── Main extraction ─────────────────────────────────────────────────────────

const ASSIGN_RE = /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n;]+?)?\s*=\s*(?!=)|\bexport\s+default\s+)/g;

function inRanges(index, ranges) {
  return ranges.some(([a, b]) => index >= a && index < b);
}

/**
 * Extracts rules from a JS/TS source string.
 * Returns { library, rules, skipped, componentCount } where each rule is
 *   { selectors, declarations, source:{file,line}, mediaContext, meta }
 * and `meta` carries cssInJs / library / component / localScope / dynamic info.
 */
function extractCssInJs(source, filePath = '<input>') {
  const library = detectLibrary(source);
  if (!library) return { library: null, rules: [], skipped: [], componentCount: 0 };

  const lineOf = makeLineLookup(source);
  const constMap = collectConstants(source);
  const baseName = path.basename(filePath, path.extname(filePath));
  const entries = [];
  const consumed = [];
  const skipped = [];

  // Pass 1: locate every style definition.
  let m;
  ASSIGN_RE.lastIndex = 0;
  while ((m = ASSIGN_RE.exec(source)) !== null) {
    const name = m[1] || baseName;
    const head = parseHead(source, ASSIGN_RE.lastIndex);
    if (!head) continue;

    const line = lineOf(m.index);
    let parts = null;
    let node = null;
    let end;

    if (head.body.type === 'template') {
      const t = parseTemplate(source, head.body.index);
      parts = t.parts;
      end = t.end;
    } else {
      const c = parseCallBody(source, head.body.index);
      end = c.end;
      node = c.node;
      if (!node) {
        consumed.push([m.index, end]);
        skipped.push({ line, name, reason: 'object styles are not a literal or a function returning a literal — could not be statically parsed' });
        ASSIGN_RE.lastIndex = end;
        continue;
      }
    }

    consumed.push([m.index, end]);
    ASSIGN_RE.lastIndex = end;
    if (head.kind === 'keyframes') continue; // animations are not modeled
    entries.push({ name, head, parts, node, line });
  }

  // css`` helpers are inlined wherever they are interpolated.
  const helpers = new Map();
  for (const e of entries) {
    if (e.head.kind === 'css') helpers.set(e.name, { parts: e.parts, node: e.node });
  }

  // Pass 2: convert each entry to rules.
  const rules = [];
  const componentNames = new Set();

  for (const entry of entries) {
    const ctx = makeContext(constMap, helpers);
    let scss = entry.node ? objectToScss(entry.node, ctx) : templateToScss(entry.parts, ctx);
    scss = attachLeadingPseudos(scss);

    const isGlobal = entry.head.kind === 'createGlobalStyle' || entry.head.kind === 'injectGlobal';
    const wrapped = isGlobal ? scss : '.' + entry.name + ' {\n' + scss + '\n}';

    let parsed;
    try {
      parsed = parseCSS(expandSCSS(wrapped), filePath);
    } catch (err) {
      skipped.push({ line: entry.line, name: entry.name, reason: 'could not be parsed: ' + err.message });
      continue;
    }

    if (entry.head.kind === 'styled') componentNames.add(entry.name);

    for (const rule of parsed) {
      const selectors = [];
      let unresolvedSelector = false;
      for (const sel of rule.selectors) {
        const r = restore(sel, ctx);
        if (r.hit) unresolvedSelector = true;
        selectors.push(r.text);
      }

      const declarations = [];
      for (const d of rule.declarations) {
        if (PH_RE.test(d.prop)) { PH_RE.lastIndex = 0; ctx.dropped++; continue; }
        PH_RE.lastIndex = 0;
        const r = restore(d.value, ctx);
        declarations.push(r.hit ? { ...d, value: r.text, dynamic: true } : d);
      }

      const mediaContext = rule.mediaContext ? restore(rule.mediaContext, ctx).text : null;

      const meta = {
        cssInJs: true,
        library,
        component: entry.name,
        kind: isGlobal ? 'global' : entry.head.kind === 'css' ? 'css-helper' : 'styled',
        localScope: !isGlobal,
      };
      if (entry.head.tag) meta.tag = entry.head.tag;
      if (entry.head.extendsName) meta.extends = entry.head.extendsName;
      if (ctx.dropped > 0) meta.dynamicInterpolations = ctx.dropped;
      if (unresolvedSelector) meta.unresolvedSelector = true;
      if (declarations.some(d => d.dynamic)) meta.hasDynamicValues = true;

      rules.push({
        selectors,
        declarations,
        mediaContext,
        source: { file: filePath, line: entry.line },
        meta,
      });
    }
  }

  // Report styles we saw but could not attach to a selector.
  const anonRe = /(?<![\w$.])(?:css\s*=\s*\{|css\s*`|css\s*\(\s*\{|styled\s*(?:\.[a-z]\w*|\([^)\n]*\))\s*(?:<[^`\n]*>)?\s*(?:\.\w+\([^)\n]*\)\s*)*[`(])/g;
  while ((m = anonRe.exec(source)) !== null) {
    if (inRanges(m.index, consumed)) continue;
    if (insideStringOnLine(source, m.index)) continue;
    const isProp = /^css\s*=/.test(m[0]);
    skipped.push({
      line: lineOf(m.index),
      name: null,
      reason: isProp
        ? 'Emotion css prop on a JSX element — anonymous, no selector to target'
        : 'style block is not assigned directly to a named variable — no selector to target',
    });
  }

  return { library, rules, skipped, componentCount: componentNames.size };
}

/**
 * Finds component names defined in more than one file. Because components are
 * addressed by variable name, these are ambiguous when queried by selector.
 */
function findAmbiguousComponents(rules) {
  const byName = new Map();
  for (const r of rules) {
    if (!r.cssInJs || r.kind === 'global') continue;
    if (!byName.has(r.component)) byName.set(r.component, new Set());
    byName.get(r.component).add(r.source.file);
  }
  const out = [];
  for (const [component, files] of byName) {
    if (files.size > 1) out.push({ component, files: [...files].map(f => path.basename(f)) });
  }
  return out;
}

module.exports = {
  JS_EXTENSIONS,
  isCssInJsFile,
  detectLibrary,
  extractCssInJs,
  findAmbiguousComponents,
  toKebabCase,
  collectConstants,
};
