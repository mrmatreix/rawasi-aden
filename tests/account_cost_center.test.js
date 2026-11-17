const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAccountCostCenter } = require('../server/services/accountCostCenterService');

test('account center requirement follows actual parent type and only accepts active centers', async () => {
  const db = { get: async (sql, [id]) => sql.includes('FROM accounts')
    ? { type: id === 1 ? 'expense' : id === 2 ? 'revenue' : 'asset' }
    : id === 10 ? { id: 10 } : null };
  for (const parentId of [1, 2]) {
    await assert.rejects(resolveAccountCostCenter(db, parentId, 'asset', null), error => error.statusCode === 400);
    const result = await resolveAccountCostCenter(db, parentId, 'asset', 10);
    assert.equal(result.cost_center_id, 10);
    assert.notEqual(result.type, 'asset');
    await assert.rejects(resolveAccountCostCenter(db, parentId, 'asset', 99), /نشط وصالح/);
  }
  assert.equal((await resolveAccountCostCenter(db, 3, 'asset', null)).cost_center_id, null);
  await assert.rejects(resolveAccountCostCenter(db, null, 'مصروفات', null), /إلزامي/);
});

test('default center follows account type and explicit mandatory usage', async () => {
  const db = { get: async () => ({ type: 'expense' }) };
  await assert.rejects(resolveAccountCostCenter(db, 1, 'asset', null, 1), /إلزامي/);
  await assert.rejects(resolveAccountCostCenter(db, 1, 'asset', null, 0), /إلزامي/);
  assert.equal((await resolveAccountCostCenter(db, 1, 'asset', 10, 1)).cost_center_required, 1);
  assert.equal((await resolveAccountCostCenter({ get: async () => null }, null, 'asset', null, 0)).cost_center_required, 0);
  await assert.rejects(resolveAccountCostCenter(db, 1, 'asset', null, 'anything'), /إلزامي أو غير إلزامي/);
});
