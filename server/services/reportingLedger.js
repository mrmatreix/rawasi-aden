const { context } = require('./reportFilterService');
// Read-only ledger: include pending documents once, without posting them.
function reportingSql(sql, filters = context.getStore() || {}) {
  if (!/\bjournal_entries\b|\bjournal_entry_lines\b/i.test(sql)) {
    if (!context.getStore()) return sql;
    const states = filters.posting_status === 'posted' ? "'posted','closed'" : filters.posting_status === 'unposted' ? "'draft','under_review','approved'" : "'posted','closed','draft','under_review','approved'";
    let scoped = sql.replace(/NOT IN\s*\(([^)]*)\)/g, (full, values) => 'NOT IN (' + values.split(',').filter(value => value.trim() !== "'draft'").join(',') + ')').replace(/\b([ep])\.status IN \('posted', 'approved'\)/g, '$1.status IN (' + states + ')');
    for (const table of ['payments','expenses']) {
      const where = 'status IN (' + states + ')' + (filters.cost_center_id ? ' AND cost_center_id = ' + Number(filters.cost_center_id) : '');
      scoped = scoped.replace(new RegExp('\\bFROM\\s+' + table + '\\b(?:\\s+([pebg])\\b)?', 'gi'), (match, alias) => 'FROM (SELECT * FROM ' + table + ' WHERE ' + where + ') AS ' + (alias || table));
    }
    for (const [table, no, kinds] of [['bills','bill_no',"'فاتورة','مستخلص','bill','billing'"],['goods_receipt_notes','grn_no',"'استلام مواد','استلام بضاعة','GRN','goods_receipt'"]]) {
      if (filters.posting_status === 'all' && !filters.cost_center_id) continue;
      const link = 'SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id = j.id WHERE (j.reference_no = d.' + no + ' OR (j.reference_id = d.id AND j.reference_type IN (' + kinds + ')))';
      const posted = 'EXISTS (' + link + " AND j.status IN ('posted','closed'))";
      const where = [filters.posting_status === 'posted' ? posted : filters.posting_status === 'unposted' ? 'NOT ' + posted : '1=1'];
      if (filters.cost_center_id) where.push('EXISTS (' + link + ' AND l.cost_center_id = ' + Number(filters.cost_center_id) + ')');
      scoped = scoped.replace(new RegExp('\\bFROM\\s+' + table + '\\b(?:\\s+([pebg])\\b)?', 'gi'), (match, alias) => 'FROM (SELECT d.* FROM ' + table + ' d WHERE ' + where.join(' AND ') + ') AS ' + (alias || table));
    }
    return scoped;
  }
  const statusList = filters.posting_status === 'posted' ? "'posted', 'closed'" : filters.posting_status === 'unposted' ? "'draft', 'under_review', 'approved'" : "'posted', 'closed', 'draft', 'under_review', 'approved'";
  const centerClause = filters.cost_center_id ? ' WHERE cost_center_id = ' + Number(filters.cost_center_id) : '';
  const rewritten = sql.replace(/\bjournal_entry_lines\b/g, 'report_lines')
    .replace(/\bjournal_entries\b/g, 'report_entries')
    .replace(/je\.status\s*=\s*'posted'/g, 'je.status IN (' + statusList + ')' );
  return `WITH report_vouchers AS (
    SELECT -2 * e.id AS id, e.id AS reference_id, 'سند صرف' AS reference_type,
      e.receipt_no AS entry_no, e.date, e.notes AS description, e.status,
      e.account_id, e.settlement_account_id, e.cost_center_id, e.project_id,
      CASE WHEN e.local_amount > 0 THEN e.local_amount ELSE e.amount * COALESCE(NULLIF(e.exchange_rate, 0), 1) END AS amount,
      0 AS is_receipt
    FROM expenses e WHERE e.status IN ('draft', 'under_review', 'approved')
      AND e.account_id IS NOT NULL AND e.settlement_account_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.reference_type = 'سند صرف'
        AND j.reference_id = e.id AND j.status IN ('posted', 'closed', 'draft', 'under_review', 'approved'))
    UNION ALL
    SELECT -2 * p.id - 1, p.id, CASE WHEN p.type = 'قبض' THEN 'سند قبض' ELSE 'سند صرف' END,
      p.receipt_no, p.date, p.notes, p.status, p.account_id, p.settlement_account_id, p.cost_center_id, p.project_id,
      CASE WHEN p.local_amount > 0 THEN p.local_amount ELSE p.amount * COALESCE(NULLIF(p.exchange_rate, 0), 1) END,
      CASE WHEN p.type = 'قبض' THEN 1 ELSE 0 END
    FROM payments p WHERE p.status IN ('draft', 'under_review', 'approved')
      AND p.account_id IS NOT NULL AND p.settlement_account_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entries j
        WHERE j.reference_type = CASE WHEN p.type = 'قبض' THEN 'سند قبض' ELSE 'سند صرف' END
        AND j.reference_id = p.id AND j.status IN ('posted', 'closed', 'draft', 'under_review', 'approved'))
  ), all_report_entries AS (
    SELECT id, entry_no, date, description, status, reference_type, reference_id, total_debit, total_credit FROM journal_entries
    UNION ALL
    SELECT id, entry_no, date, description, status, reference_type, reference_id, amount, amount FROM report_vouchers
  ), all_report_lines AS (
    SELECT id, entry_id, account_id, cost_center_id, project_id, debit, credit, notes FROM journal_entry_lines
    UNION ALL
    SELECT id * 2, id, settlement_account_id, cost_center_id, project_id,
      CASE WHEN is_receipt = 1 THEN amount ELSE 0 END,
      CASE WHEN is_receipt = 0 THEN amount ELSE 0 END, description FROM report_vouchers
    UNION ALL
    SELECT id * 2 - 1, id, account_id, cost_center_id, project_id,
      CASE WHEN is_receipt = 0 THEN amount ELSE 0 END,
      CASE WHEN is_receipt = 1 THEN amount ELSE 0 END, description FROM report_vouchers
  ), report_entries AS (SELECT * FROM all_report_entries WHERE status IN (${statusList})),
  report_lines AS (SELECT * FROM all_report_lines${centerClause}) ${rewritten}`;
}

module.exports = {
  reportingSql,
  query: (sql, params) => require('../database/db').query(reportingSql(sql), params),
  get: (sql, params) => require('../database/db').get(reportingSql(sql), params)
};
