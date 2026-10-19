const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextSequentialCode, assertAccountNumber } = require('../server/services/accountNumberingService');

test('sequential numbering follows every level and fills gaps without changing existing codes', () => {
  for (const [parent, first, next] of [[null, '1', '2'], ['1', '11', '12'], ['11', '111', '112'],
    ['111', '11101', '11102'], ['11101', '11101001', '11101002']]) {
    assert.equal(nextSequentialCode(parent, []).suggested_code, first);
    assert.equal(nextSequentialCode(parent, [first]).suggested_code, next);
  }
  assert.equal(nextSequentialCode('11102', ['11102001', '11102003', '11102004']).suggested_code, '11102002');
  assert.equal(nextSequentialCode('11102', ['11102009', '11102010']).suggested_code, '11102001');
  assert.throws(() => nextSequentialCode('11102001', []), /تفصيلي نهائي/);
  assert.throws(() => nextSequentialCode('11', Array.from({ length: 9 }, (_, i) => '11' + (i + 1))), /اكتمل/);
});

test('server rejects jumps and wrong parent prefixes with the required next code', async () => {
  const db = {
    get: async (sql, [id]) => id === 1 ? { id: 1, code: '11102' } : null,
    query: async () => [{ id: 2, code: '11102001' }, { id: 3, code: '11102003' }]
  };
  assert.equal((await assertAccountNumber(db, '11102002', 1)).level, 5);
  await assert.rejects(assertAccountNumber(db, '11102008', 1), err => err.statusCode === 400 && err.suggested_code === '11102002');
  await assert.rejects(assertAccountNumber(db, '11101002', 1), /11102002/);
  await assert.rejects(assertAccountNumber(db, '11102002', 99), /الأب غير موجود/);
});
