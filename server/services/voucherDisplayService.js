async function loadVoucherSources(db) {
  const rows = await db.query(`SELECT id, receipt_no, 'expense' AS entity_kind, 'سند صرف' AS reference_type, payment_method, settlement_account_id FROM expenses
    UNION ALL SELECT id, receipt_no, 'payment' AS entity_kind, CASE WHEN type = 'قبض' THEN 'سند قبض' ELSE 'سند صرف' END,
    payment_method, settlement_account_id FROM payments`);
  const index = new Map();
  for (const row of rows) {
    const key = `${row.reference_type}:${row.id}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

function voucherSource(entry, index) {
  const candidates = index.get(`${entry.reference_type}:${entry.reference_id}`) || [];
  return candidates.find(row => row.receipt_no === entry.reference_no || row.receipt_no === entry.entry_no ||
    String(entry.description || entry.entry_description || entry.notes || '').includes(row.receipt_no)) ||
    (candidates.length === 1 ? candidates[0] : null);
}

function journalDisplay(entry, index) {
  const source = voucherSource(entry, index);
  return { ...entry, voucher_no: source?.receipt_no || null, display_no: source?.receipt_no || entry.entry_no };
}

module.exports = { loadVoucherSources, voucherSource, journalDisplay };
