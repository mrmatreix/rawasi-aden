const { loadVoucherSources, voucherSource } = require('./voucherDisplayService');

async function getCashAccountActivity(db, { type, from_date, to_date, all, include_closed } = {}) {
  const rows = await db.query(`SELECT je.id AS source_id, je.entry_no, je.entry_no AS reference_no, je.reference_type, je.reference_id,
    je.date, je.status, je.description AS notes, jel.account_id, a.code AS account_code, a.name AS account_name,
    SUM(jel.debit) AS cash_in, SUM(jel.credit) AS cash_out
    FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.status = 'posted' AND (a.code LIKE '11101%' OR a.code LIKE '11102%')
    GROUP BY je.id, je.entry_no, je.reference_type, je.reference_id, je.date, je.status, je.description, jel.account_id, a.code, a.name
    ORDER BY je.date, je.entry_no, jel.account_id`);
  const sources = await loadVoucherSources(db);
  const periods = include_closed === 'true' ? [] : await db.query("SELECT start_date, end_date FROM accounting_periods WHERE status = 'closed'");
  const labels = { posted: 'مرحل', closed: 'مرحل', draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمد بانتظار الترحيل' };
  const balances = new Map();
  const movements = [];
  const summary = { initial_balance: 0, total_cash_in: 0, total_cash_out: 0, total_withdrawals: 0,
    current_balance: 0, posted_balance: 0, pending_cash_in: 0, pending_cash_out: 0, pending_count: 0 };
  for (const row of rows) {
    const movementType = String(row.account_code).startsWith('11102') ? 'بنك' : 'نقدي';
    if ((type === 'بنك' || type === 'نقدي') && movementType !== type) continue;
    if (to_date && row.date > to_date) continue;
    const cashIn = Number(row.cash_in) || 0;
    const cashOut = Number(row.cash_out) || 0;
    const previous = balances.get(row.account_id) || 0;
    const current = Math.round((previous + cashIn - cashOut) * 100) / 100;
    balances.set(row.account_id, current);
    const posted = ['posted', 'closed'].includes(row.status);
    if (posted) summary.posted_balance += cashIn - cashOut;
    if (from_date && row.date < from_date) { summary.initial_balance += cashIn - cashOut; continue; }
    summary.total_cash_in += cashIn;
    summary.total_cash_out += cashOut;
    if (!posted) {
      summary.pending_cash_in += cashIn;
      summary.pending_cash_out += cashOut;
      summary.pending_count++;
    }
    if (periods.some(period => row.date >= period.start_date && row.date <= period.end_date)) continue;
    const source = voucherSource(row, sources);
    const isSettlement = !source || Number(row.account_id) === Number(source.settlement_account_id);
    const role = source ? (isSettlement ? 'حساب الدفع / التحصيل' : 'الحساب المقابل — تحويل داخلي') : 'قيد يومية';
    movements.push({ ...row, id: `${row.source_id}:${row.account_id}`, cash_in: cashIn, cash_out: cashOut,
      reference_no: source?.receipt_no || row.reference_no, account_role: isSettlement ? 'settlement' : 'counterpart', account_role_label: role,
      is_posted: posted, status_label: labels[row.status], movement_type: movementType,
      payment_method: source?.payment_method || (movementType === 'بنك' ? 'تحويل بنكي' : 'نقدي'), currency: 'ر.ي',
      previous_balance: previous, current_balance: current, withdrawals: 0 });
  }
  summary.current_balance = [...balances.values()].reduce((sum, balance) => sum + balance, 0);
  for (const key of Object.keys(summary)) summary[key] = Math.round(summary[key] * 100) / 100;
  movements.reverse();
  return { success: true, data: all === 'true' ? movements : movements.slice(0, 100), summary };
}

module.exports = { getCashAccountActivity };
