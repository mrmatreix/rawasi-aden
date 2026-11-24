'use strict';
// One numbering scheme for every document series (stage 3, H7/R6).
// A row in document_sequences(series, period_year) holds the last number issued. It is incremented inside the
// caller's transaction, so two postings never get the same number and a rolled-back posting gives its
// number back. The first use of a series/year starts after the highest number already present in the
// target table, and every number is checked against that table, so legacy rows never collide.
// The year always comes from the document date, never from "today".

const DEFAULTS = Object.freeze({ table: 'journal_entries', column: 'entry_no', width: 4, yearly: true });

// Journal series: each prefix keeps the format users already know (JV-2026-0001, JE-00012, ...).
const JOURNAL_SERIES = Object.freeze({
  JV: { prefix: 'JV' },            // manual, inventory, material, bank
  'JV-RC': { prefix: 'JV-RC' },    // receipt vouchers
  'JV-PV': { prefix: 'JV-PV' },    // payment vouchers
  'JV-PAY': { prefix: 'JV-PAY' },  // payroll
  'JV-TAX': { prefix: 'JV-TAX' },
  'JV-LG': { prefix: 'JV-LG' },
  'JV-REL': { prefix: 'JV-REL' },
  'JE-MIR': { prefix: 'JE-MIR' },
  REV: { prefix: 'REV' },          // reversals
  JE: { prefix: 'JE', yearly: false, width: 5 } // bills and revenue recognition (legacy format without year)
});

function seriesConfig(series, overrides = {}) {
  const known = JOURNAL_SERIES[series];
  return { ...DEFAULTS, prefix: series, ...(known || {}), ...overrides };
}

function yearOf(date) {
  const y = Number(String(date || '').slice(0, 4));
  if (!Number.isInteger(y) || y < 1900 || y > 2999) {
    throw Object.assign(new Error('تاريخ المستند غير صالح لتوليد الرقم التسلسلي'), { statusCode: 400 });
  }
  return y;
}

function format(cfg, year, n) {
  return `${cfg.prefix}-${cfg.yearly ? year + '-' : ''}${String(n).padStart(cfg.width, '0')}`;
}

function headOf(cfg, year) { return `${cfg.prefix}-${cfg.yearly ? year + '-' : ''}`; }

// Highest numeric suffix already used for this prefix/year in the target table.
async function highestExisting(h, cfg, year) {
  const head = headOf(cfg, year);
  const rows = await h.query(`SELECT ${cfg.column} AS no FROM ${cfg.table} WHERE ${cfg.column} LIKE ?`, [head + '%']);
  let max = 0;
  for (const r of rows) {
    const tail = String(r.no).slice(head.length);
    if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return max;
}

/**
 * Issue the next number of a series. `h` must be the open transaction handle.
 * @returns {Promise<string>} e.g. "JV-2026-0042"
 */
async function next(h, series, { date, ...overrides } = {}) {
  if (!h || typeof h.run !== 'function') throw new Error('numbering requires a transaction handle');
  const cfg = seriesConfig(series, overrides);
  const year = cfg.yearly ? yearOf(date) : 0;
  const key = `${cfg.table}.${cfg.column}:${cfg.prefix}`;
  const row = await h.get('SELECT last_no FROM document_sequences WHERE series = ? AND period_year = ?', [key, year]);
  if (!row) {
    const start = await highestExisting(h, cfg, year);
    await h.run('INSERT OR IGNORE INTO document_sequences (series, period_year, last_no) VALUES (?, ?, ?)', [key, year, start]);
  }
  for (let guard = 0; guard < 10000; guard++) {
    await h.run('UPDATE document_sequences SET last_no = last_no + 1, updated_at = CURRENT_TIMESTAMP WHERE series = ? AND period_year = ?', [key, year]);
    const { last_no: n } = await h.get('SELECT last_no FROM document_sequences WHERE series = ? AND period_year = ?', [key, year]);
    const candidate = format(cfg, year, n);
    // A number written by a path that does not use this service yet is skipped, never reused.
    if (!await h.get(`SELECT 1 AS x FROM ${cfg.table} WHERE ${cfg.column} = ?`, [candidate])) return candidate;
  }
  throw new Error(`تعذر توليد رقم فريد للسلسلة ${cfg.prefix}`);
}

/** The number the next call would most likely issue (display only; never store it). */
async function peek(h, series, { date, ...overrides } = {}) {
  const cfg = seriesConfig(series, overrides);
  const year = cfg.yearly ? yearOf(date) : 0;
  const key = `${cfg.table}.${cfg.column}:${cfg.prefix}`;
  const row = await h.get('SELECT last_no FROM document_sequences WHERE series = ? AND period_year = ?', [key, year]);
  const base = Math.max(row ? Number(row.last_no) : 0, await highestExisting(h, cfg, year));
  return format(cfg, year, base + 1);
}

/** Journal entry numbers: series is one of JOURNAL_SERIES (default JV). */
function nextJournalNumber(h, { series = 'JV', date }) { return next(h, series, { date }); }

module.exports = { next, peek, nextJournalNumber, JOURNAL_SERIES, yearOf };
