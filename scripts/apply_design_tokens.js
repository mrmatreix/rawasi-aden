#!/usr/bin/env node
/**
 * يستبدل ألوان النص الثابتة (المصممة للوضع الليلي) بمتغيرات نظام التصميم الموحّد في css/style.css
 * حتى تبقى مقروءة في الوضعين الليلي والنهاري.
 *
 * - يغيّر خاصية color فقط (لا الخلفيات ولا الحدود).
 * - يتجاهل العنصر/القاعدة التي لها خلفية ثابتة معتمة (زر ملوّن، شريط داكن...) لأن نصها مصمم لتلك الخلفية.
 * - يتجاهل قواعد الوضع النهاري نفسها.
 * - يحتفظ باللون الأصلي احتياطياً: var(--color-info, #38bdf8) فتبقى نوافذ الطباعة كما هي.
 *
 * الاستخدام: node scripts/apply_design_tokens.js [--check]
 *   --check  يعرض عدد المواضع المتبقية دون تعديل (يُستخدم في الاختبار).
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const TOKENS = new Map([
  ['#38bdf8', '--color-info'], ['#bae6fd', '--color-info'], ['#7dd3fc', '--color-info'], ['#93c5fd', '--color-info'], ['#0ea5e9', '--color-info'], ['#60a5fa', '--color-info'], ['#3b82f6', '--color-info'],
  ['#10b981', '--color-success'], ['#bbf7d0', '--color-success'], ['#a7f3d0', '--color-success'], ['#6ee7b7', '--color-success'], ['#34d399', '--color-success'], ['#4ade80', '--color-success'], ['#22c55e', '--color-success'],
  ['#f87171', '--color-danger'], ['#fecaca', '--color-danger'], ['#ef4444', '--color-danger'], ['#fca5a5', '--color-danger'],
  ['#f59e0b', '--color-warning'], ['#fde68a', '--color-warning'], ['#fcd34d', '--color-warning'], ['#fbbf24', '--color-warning'], ['#facc15', '--color-warning'],
  ['#f6d878', '--text-gold'], ['#f3cf65', '--text-gold'], ['#d4af37', '--text-gold'], ['#d6ad35', '--text-gold'], ['var(--gold-light)', '--text-gold'], ['var(--gold-primary)', '--text-gold'],
  ['#a78bfa', '--color-purple'], ['#c4b5fd', '--color-purple'],
  ['#94a3b8', '--text-secondary'], ['#cbd5e1', '--text-secondary'], ['#a8b8cc', '--text-secondary'],
  ['#f8fafc', '--text-primary'], ['#f1f5f9', '--text-primary'], ['#e2e8f0', '--text-primary']
]);
const VALUE = '(#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{3}\\b|var\\(--gold-(?:light|primary)\\))';
const COLOR_DECL = new RegExp('(?<![-\\w])color(\\s*:\\s*)' + VALUE + '(\\s*!important)?(?=\\s*(?:;|"|\'|`|}|$))', 'g');

/** هل تحدد هذه التصريحات خلفية ثابتة معتمة؟ */
function hasOpaqueBackground(decls) {
  for (const m of decls.matchAll(/(?<![-\w])background(?:-color)?\s*:\s*([^;"'`}]+)/g)) {
    const v = m[1].trim();
    if (/^var\(|^transparent|^none|^inherit/.test(v)) continue;
    if (/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/.test(v)) return true;
    for (const c of v.matchAll(/rgba?\(([^)]*)\)/g)) { const p = c[1].split(',').map(s => s.trim()); if (p.length < 4 || parseFloat(p[3]) >= 0.6) return true; }
  }
  return false;
}

/** لوحات غائرة بخلفية داكنة شفافة ثابتة: تصبح var(--bg-sunken) (نفس اللون ليلاً، رمادي فاتح نهاراً) */
const SUNKEN = /(?<![-\w])(background(?:-color)?\s*:\s*)(rgba\(\s*(?:15\s*,\s*23\s*,\s*42|0\s*,\s*0\s*,\s*0|8\s*,\s*17\s*,\s*31)\s*,\s*0?\.(?:2|25|3|35|4|45|5|55|6|65|7|75|8)\d*\s*\))(?=\s*(?:;|"|'|`|}|$|!))/g;
function replaceSunken(decls, stats) {
  if (/position\s*:\s*fixed|backdrop-filter|inset\s*:/.test(decls)) return decls; // خلفيات النوافذ المنبثقة تبقى داكنة
  return decls.replace(SUNKEN, (all, prop, value) => { stats.n++; return prop + 'var(--bg-sunken, ' + value.replace(/\s+/g, ' ') + ')'; });
}

function replaceColors(decls, stats) {
  decls = replaceSunken(decls, stats);
  if (hasOpaqueBackground(decls)) return decls;
  return decls.replace(COLOR_DECL, (all, sep, value, imp = '') => {
    const token = TOKENS.get(value.toLowerCase());
    if (!token) return all;
    stats.n++;
    const fallback = value.startsWith('var(') ? '' : ', ' + value;
    return `color${sep}var(${token}${fallback})${imp}`;
  });
}

/** الألوان داخل تعابير JavaScript: color: ${ok ? '#10b981' : '#f87171'} و el.style.color = ok ? '#10b981' : ... */
function replaceQuotedLiterals(expr, stats) {
  return expr.replace(/(['"])(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\1/g, (all, q, value) => {
    const token = TOKENS.get(value.toLowerCase());
    if (!token) return all;
    stats.n++;
    return q + 'var(' + token + ', ' + value + ')' + q;
  });
}

function transformExpressions(src, stats) {
  return src
    .replace(/((?<![-\w])color\s*:\s*\$\{)([^{}]*)(\})/g, (all, a, expr, b) => a + replaceQuotedLiterals(expr, stats) + b)
    .replace(/(\.style\.color\s*=\s*)([^;\n]+)/g, (all, a, expr) => a + replaceQuotedLiterals(expr, stats))
    // أجزاء CSS داخل نصوص JS: '...; color: #22c55e; ...'
    .replace(/(['"])((?:(?!\1)[^\n\\])*?(?<![-\w])color\s*:\s*(?:#[0-9a-fA-F]{3,6}|var\(--gold-(?:light|primary)\))[^'"\n]*)\1/g, (all, q, body) => q + replaceColors(body, stats) + q);
}

function transformMarkup(src, stats) {
  // style="..." و style='...' في HTML وقوالب JavaScript
  const out = src.replace(/(\bstyle\s*=\s*)(["'])([^"'<>]*?)\2/g, (all, pre, q, decls) => pre + q + replaceColors(decls, stats) + q);
  return transformExpressions(out, stats);
}

function transformCss(src, stats) {
  return src.replace(/([^{}]+)\{([^{}]*)\}/g, (all, selector, decls) => {
    // الوضع النهاري والطباعة والشريط العلوي (داكن دائماً) لها ألوانها الخاصة
    if (/light-mode|@media\s+print|header/.test(selector)) return all;
    return selector + '{' + replaceColors(decls, stats) + '}';
  });
}

const targets = [
  ['index.html', transformMarkup],
  ...fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js') && !/xlsx|dialogs|print-designer/.test(f)).map(f => ['js/' + f, transformMarkup]),
  ['css/style.css', transformCss]
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
    console.log(`${check ? 'remaining' : 'updated'} ${rel}: ${stats.n}`);
  }
}
console.log(`${check ? 'remaining' : 'updated'} total: ${total}`);
if (check && total) process.exitCode = 1;
