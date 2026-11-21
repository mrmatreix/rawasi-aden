#!/usr/bin/env node
/**
 * يوحّد المسافات (margin / padding / gap) على سلّم ثابت حتى تتناسق الشاشات.
 *
 * السلّم: 2 4 6 8 10 12 14 16 20 24 32 40 بكسل (وما فوق 40 يبقى كما هو).
 * القيم الشاذة تُقرَّب لأقرب درجة: 3→2، 5→4، 7→6، 9→8، 11→12، 13→12، 15→16، 18→16، 22→20، 25→24، 28→32، 30→32، 35→32، 36→32.
 *
 * لا يلمس:
 * - قوالب الطباعة داخل JavaScript (من <html أو <!DOCTYPE حتى </html>) لأن تخطيط الورق محسوب بدقة.
 * - قواعد @media print و@page والمحددات الخاصة بالطباعة في css/style.css.
 * - 0 و1px (خطوط فاصلة) والقيم فوق 40px.
 *
 * الاستخدام: node scripts/snap_spacing.js [--check]
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const SNAP = { 3: 2, 5: 4, 7: 6, 9: 8, 11: 12, 13: 12, 15: 16, 18: 16, 22: 20, 25: 24, 26: 24, 28: 32, 30: 32, 35: 32, 36: 32 };
const DECL = /((?<![-\w])(?:margin|padding|gap|row-gap|column-gap|margin-(?:top|bottom|left|right|inline-start|inline-end)|padding-(?:top|bottom|left|right|inline-start|inline-end))\s*:\s*)([^;"'`}{<>]+)/g;

function snapDecls(text, stats) {
  return text.replace(DECL, (all, prop, value) => {
    const out = value.replace(/(^|[\s(,-])(\d+)px\b/g, (m, pre, n) => {
      const to = SNAP[n];
      if (to === undefined) return m;
      stats.n++;
      return pre + to + 'px';
    });
    return prop + out;
  });
}

function transformJs(src, stats) {
  const lines = src.split('\n');
  let inPrint = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inPrint && /<!DOCTYPE|<html[\s>]/i.test(l)) inPrint = true;
    if (!inPrint) lines[i] = snapDecls(l, stats);
    if (inPrint && /<\/html>/i.test(l)) inPrint = false;
  }
  return lines.join('\n');
}

function transformCss(src, stats) {
  // يمشي على القواعد مع تتبّع @media print
  let out = '', i = 0, depth = 0;
  const stack = [];
  const PRINT_SEL = /print|@page|voucher|invoice-doc|quotation-doc/i;
  while (i < src.length) {
    const open = src.indexOf('{', i), close = src.indexOf('}', i);
    if (open === -1 && close === -1) { out += src.slice(i); break; }
    if (open !== -1 && (close === -1 || open < close)) {
      const head = src.slice(i, open);
      // نص قبل { قد يحتوي تصريحات سابقة (داخل قاعدة متداخلة)؛ المحدد هو ما بعد آخر ; أو }
      const sel = head.slice(Math.max(head.lastIndexOf(';'), head.lastIndexOf('}')) + 1);
      const skip = stack.some(Boolean) || PRINT_SEL.test(sel);
      stack.push(skip || /@media\s+print/i.test(sel));
      out += head + '{';
      i = open + 1;
      // قاعدة متداخلة (@media ...): يُترك ما بعدها ليُقرأ كمحدد في الدورة التالية
      const nOpen = src.indexOf('{', i), nClose = src.indexOf('}', i);
      if (nOpen !== -1 && nOpen < nClose) continue;
      const body = src.slice(i, nClose);
      out += stack[stack.length - 1] ? body : snapDecls(body, stats);
      i = nClose;
    } else {
      out += src.slice(i, close + 1);
      stack.pop();
      i = close + 1;
    }
  }
  return out;
}

const targets = [
  ['css/style.css', transformCss],
  ['index.html', (src, stats) => snapDecls(src, stats)],
  ...fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js') && !/xlsx|print-designer|dialogs/.test(f)).map(f => ['js/' + f, transformJs])
];

const check = process.argv.includes('--check');
let total = 0;
for (const [rel, fn] of targets) {
  const file = path.join(root, rel);
  const src = fs.readFileSync(file, 'utf8');
  const stats = { n: 0 };
  const out = fn(src, stats);
  if (stats.n) {
    total += stats.n;
    if (!check) fs.writeFileSync(file, out);
    console.log(`${check ? 'off-scale' : 'snapped'} ${rel}: ${stats.n}`);
  }
}
console.log(`${check ? 'off-scale' : 'snapped'} total: ${total}`);
if (check && total) process.exitCode = 1;
