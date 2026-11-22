'use strict';
// Subledger derived from the general ledger (stage 4.7, M1): a party's balance is the sum of the posted journal
// lines tagged with that party, never a counter updated by hand. Lines posted before the party dimension existed
// carry no party; `untagged` reports how much of the control accounts is still unattributed.
const db = require('../../database/db');
const { PARTY_TABLES } = require('./postingService');

const subledgerError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function assertParty(type, id) {
  if (!PARTY_TABLES[type]) throw subledgerError('نوع الطرف غير صالح (client | supplier | employee)');
  if (!Number(id)) throw subledgerError('معرف الطرف غير صالح');
}

/** Balance of one party: per account and total (debit - credit), from posted entries up to asOf. */
async function partyBalance(type, id, { asOf = null, h = db } = {}) {
  assertParty(type, id);
  const params = [type, Number(id)];
  let dateCond = '';
  if (asOf) { dateCond = ' AND je.date <= ?'; params.push(asOf); }
  const rows = await h.query(`SELECT a.id AS account_id, a.code, a.name, a.normal_balance,
      COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
    FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE l.party_type = ? AND l.party_id = ? AND je.status IN ('posted', 'closed')${dateCond}
    GROUP BY a.id, a.code, a.name, a.normal_balance ORDER BY a.code`, params);
  const accounts = rows.map(r => ({ account_id: r.account_id, code: r.code, name: r.name, debit: round2(r.debit), credit: round2(r.credit), balance: round2(r.debit - r.credit) }));
  return { party_type: type, party_id: Number(id), as_of: asOf, accounts, balance: round2(accounts.reduce((s, a) => s + a.balance, 0)) };
}

/** Movements of one party in date order with a running balance (the party statement from the ledger). */
async function partyStatement(type, id, { from = null, to = null, h = db } = {}) {
  assertParty(type, id);
  const base = [type, Number(id)];
  const opening = from ? await h.get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id
    WHERE l.party_type = ? AND l.party_id = ? AND je.status IN ('posted', 'closed') AND je.date < ?`, [...base, from]) : { b: 0 };
  const params = [...base]; let cond = '';
  if (from) { cond += ' AND je.date >= ?'; params.push(from); }
  if (to) { cond += ' AND je.date <= ?'; params.push(to); }
  const rows = await h.query(`SELECT je.id AS entry_id, je.entry_no, je.date, je.reference_type, je.reference_no, je.description,
      a.code AS account_code, a.name AS account_name, l.debit, l.credit, l.notes
    FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE l.party_type = ? AND l.party_id = ? AND je.status IN ('posted', 'closed')${cond}
    ORDER BY je.date, je.id, l.id`, params);
  let running = round2(opening.b);
  const lines = rows.map(r => { running = round2(running + Number(r.debit) - Number(r.credit)); return { ...r, debit: round2(r.debit), credit: round2(r.credit), balance: running }; });
  return { party_type: type, party_id: Number(id), from, to, opening_balance: round2(opening.b), closing_balance: running, lines };
}

/** How much of a control account (e.g. receivables) is posted without a party (legacy lines). */
async function untagged(accountId, { h = db } = {}) {
  const r = await h.get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b, COUNT(*) AS n FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id
    WHERE l.account_id = ? AND l.party_id IS NULL AND je.status IN ('posted', 'closed')`, [accountId]);
  return { balance: round2(r.b), lines: Number(r.n) };
}

/** Ledger balance vs the stored counter (clients.current_balance / suppliers.balance) for review. */
async function reconcileParty(type, id, { h = db } = {}) {
  const ledger = await partyBalance(type, id, { h });
  let stored = null;
  if (type === 'client') stored = (await h.get('SELECT current_balance FROM clients WHERE id = ?', [Number(id)]))?.current_balance ?? null;
  if (type === 'supplier') {
    const row = await h.get('SELECT balance FROM suppliers WHERE id = ?', [Number(id)]);
    // suppliers are credit-natured: the stored balance is what we owe (positive), the ledger shows it as credit
    stored = row ? row.balance : null;
  }
  const ledgerAsStored = type === 'supplier' ? -ledger.balance : ledger.balance;
  return { ...ledger, stored_balance: stored == null ? null : round2(stored), ledger_balance_same_sign: round2(ledgerAsStored),
    difference: stored == null ? null : round2(Number(stored) - ledgerAsStored) };
}

module.exports = { partyBalance, partyStatement, untagged, reconcileParty };
