#!/usr/bin/env node
/* ==========================================================================
 *  Zero-dependency asset minifier for aeoleaf.
 *
 *  Why hand-rolled: esbuild/terser can't install on the virtiofs mount.
 *  Uses only Node built-ins. Produces `.min.css` / `.min.js` next to source.
 *
 *  Correctness over ratio:
 *   - CSS: char scanner. Strips comments + collapses whitespace, but PRESERVES
 *     string/url internals and, crucially, the descendant combinator space
 *     (`a .b` !== `a.b`). Only strips space around { } ; > ~ + and around
 *     ':' / ',' INSIDE declaration blocks (brace-depth aware), so selectors,
 *     var(), color-mix(in oklab, ...), calc(), and @media survive.
 *   - JS: conservative — removes comments + trailing whitespace + blank-line
 *     runs only. No token re-joining, so ASI / regex / templates can't break.
 *
 *  Usage:
 *     node scripts/minify.js              # minify into public/{css,js}
 *     node scripts/minify.js --check      # report only, write nothing
 *     node scripts/minify.js <projectRoot>  # explicit root (default: ..)
 * ======================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const argRoot = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const ROOT = argRoot ? path.resolve(argRoot) : path.join(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'public', 'css');
const JS_DIR = path.join(ROOT, 'public', 'js');
const CHECK_ONLY = process.argv.includes('--check');
const SKIP = (name) => /\.min\.(css|js)$/.test(name);

function minifyCss(src) {
  let out = ''; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i]; const next = src[i + 1];
    if (c === '/' && next === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") { const q = c; out += c; i++; while (i < n) { out += src[i]; if (src[i] === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (src[i] === q) { i++; break; } i++; } continue; }
    if (/\s/.test(c)) { let j = i; while (j < n && /\s/.test(src[j])) j++; out += ' '; i = j; continue; }
    out += c; i++;
  }
  out = out
    .replace(/\s*([{};])\s*/g, '$1')
    .replace(/\s*([>~])\s*/g, '$1')
    .replace(/\s+\+\s+/g, '+')
    .replace(/;}/g, '}')
    .replace(/\s*!\s*important/gi, '!important')
    .trim();
  // Brace-depth walk: strip the space after ':' and ',' only inside blocks.
  let res = ''; let depth = 0;
  for (let k = 0; k < out.length; k++) {
    const ch = out[k];
    if (ch === '{') { depth++; res += ch; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); res += ch; continue; }
    if (depth > 0 && (ch === ':' || ch === ',')) { res += ch; if (out[k + 1] === ' ') k++; continue; }
    res += ch;
  }
  return res;
}

function minifyJs(src) {
  let out = ''; let i = 0; const n = src.length; let lastSig = '';
  const regexAllowedBefore = (ch) => ch === '' || '(,=:[!&|?{};'.includes(ch) || /\s/.test(ch);
  while (i < n) {
    const c = src[i]; const next = src[i + 1];
    if (c === '/' && next === '/') { i += 2; while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") { const q = c; out += c; i++; while (i < n) { out += src[i]; if (src[i] === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (src[i] === q) { i++; break; } i++; } lastSig = q; continue; }
    if (c === '`') { out += c; i++; while (i < n) { out += src[i]; if (src[i] === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (src[i] === '`') { i++; break; } i++; } lastSig = '`'; continue; }
    if (c === '/' && regexAllowedBefore(lastSig)) { out += c; i++; let inClass = false; while (i < n) { out += src[i]; if (src[i] === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false; else if (src[i] === '/' && !inClass) { i++; break; } i++; } while (i < n && /[a-z]/i.test(src[i])) { out += src[i]; i++; } lastSig = '/'; continue; }
    out += c; if (!/\s/.test(c)) lastSig = c; i++;
  }
  out = out.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n').replace(/\n{2,}/g, '\n').trim();
  return out;
}

function processDir(dir, ext, minifier) {
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(ext) || SKIP(name)) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    const min = minifier(src);
    const outName = name.replace(new RegExp(ext.replace('.', '\\.') + '$'), '.min' + ext);
    const outPath = path.join(dir, outName);
    let current = null;
    try { current = fs.readFileSync(outPath, 'utf8'); } catch { /* missing output */ }
    const matches = current === min;
    if (!CHECK_ONLY) fs.writeFileSync(outPath, min, 'utf8');
    rows.push({ name, outName, before: Buffer.byteLength(src), after: Buffer.byteLength(min), matches });
  }
  return rows;
}

const fmt = (b) => (b / 1024).toFixed(1) + 'K';
const all = [...processDir(CSS_DIR, '.css', minifyCss), ...processDir(JS_DIR, '.js', minifyJs)];
let tb = 0; let ta = 0;
console.log((CHECK_ONLY ? '[check] ' : '[minify] ') + 'file'.padEnd(26) + 'before'.padStart(8) + 'after'.padStart(8) + '  saved');
for (const r of all) {
  tb += r.before; ta += r.after;
  console.log('  ' + r.name.padEnd(26) + fmt(r.before).padStart(8) + fmt(r.after).padStart(8) + '  ' + ((1 - r.after / r.before) * 100).toFixed(0) + '%');
}
console.log('  ' + 'TOTAL'.padEnd(26) + fmt(tb).padStart(8) + fmt(ta).padStart(8) + '  ' + ((1 - ta / tb) * 100).toFixed(0) + '%');
if (CHECK_ONLY) {
  const stale = all.filter((r) => !r.matches);
  if (stale.length) {
    console.error(`Stale or missing minified assets: ${stale.map((r) => r.outName).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('  all minified assets are current');
  }
}
