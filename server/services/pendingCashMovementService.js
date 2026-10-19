// Read-only projections: pending documents never change posted cash balances.
const { openPeriodCondition } = require('./operationVisibility');

async function getPendingCashMovements(db, { type, from_date, to_date, include_closed } = {}) {
  const rows = await db.query(`SELECT pending.* FROM (
    SELECT 'expense' AS source_type, e.id AS source_id, e.receipt_no AS reference_no,
           e.date, e.status, e.notes, e.settlement_account_id AS account_id,
           0 AS cash_in,
           CASE WHEN e.local_amount > 0 THEN e.local_amount
                ELSE e.amount * COALESCE(NULLIF(e.exchange_rate, 0), 1) END AS cash_out
    FROM expenses e WHERE e.status IN ('draft', 'under_review', 'approved')
    UNION ALL
    SELECT 'payment', p.id, p.receipt_no, p.date, p.status, p.notes,
           p.settlement_account_id,
           CASE WHEN p.type = 'قبض' THEN
             CASE WHEN p.local_amount > 0 THEN p.local_amount ELSE p.amount * COALESCE(NULLIF(p.exchange_rate, 0), 1) END ELSE 0 END,
           CASE WHEN p.type = 'صرف' THEN
             CASE WHEN p.local_amount > 0 THEN p.local_amount ELSE p.amount * COALESCE(NULLIF(p.exchange_rate, 0), 1) END ELSE 0 END
    FROM payments p WHERE p.status IN ('draft', 'under_review', 'approved')
    UNION ALL
    SELECT 'journal', j.id, j.entry_no, j.date, j.status, j.description,
           l.account_id, SUM(COALESCE(l.debit, 0)), SUM(COALESCE(l.credit, 0))
    FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id = j.id
    WHERE j.status IN ('draft', 'under_review', 'approved')
      AND NOT (COALESCE(j.reference_type, '') IN ('سند صرف', 'سند قبض') AND j.reference_id IS NOT NULL)
    GROUP BY j.id, j.entry_no, j.date, j.status, j.description, l.account_id
    ) pending WHERE ${openPeriodCondition('pending.date', include_closed)}
  `);
  const accounts = await db.query("SELECT id, code, name FROM accounts WHERE code LIKE '11101%' OR code LIKE '11102%'");
  const byId = new Map(accounts.map(a => [Number(a.id), a]));
  const labels = { draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمد بانتظار الترحيل' };
  return rows.flatMap(row => {
    const account = byId.get(Number(row.account_id));
    if (!account || (from_date && row.date < from_date) || (to_date && row.date > to_date)) return [];
    const movementType = String(account.code).startsWith('11102') ? 'بنك' : 'نقدي';
    if ((type === 'بنك' || type === 'نقدي') && type !== movementType) return [];
    if (!Number(row.cash_in) && !Number(row.cash_out)) return [];
    return [{ ...row, id: `${row.source_type}:${row.source_id}:${row.account_id}`,
      account_code: account.code, account_name: account.name,
      movement_type: movementType, payment_method: movementType === 'بنك' ? 'تحويل بنكي' : 'نقدي',
      currency: 'ر.ي', is_posted: false, status_label: labels[row.status],
      previous_balance: null, current_balance: null, withdrawals: 0,
      notes: `[${labels[row.status]} — غير مرحل] ${row.notes || ''}` }];
  });
}

module.exports = { getPendingCashMovements };
