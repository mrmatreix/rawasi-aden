// Only operational lists hide closed periods. Historical reports retain all entries.
function openPeriodCondition(dateColumn, includeClosed) {
  if (!/^(?:[a-z]+\.)?date$/.test(dateColumn)) throw new Error('Invalid operation date column');
  if (includeClosed === 'true') return '1 = 1';
  return `NOT EXISTS (SELECT 1 FROM accounting_periods closed_period
    WHERE closed_period.status = 'closed'
      AND ${dateColumn} >= closed_period.start_date AND ${dateColumn} <= closed_period.end_date)`;
}

module.exports = { openPeriodCondition };
