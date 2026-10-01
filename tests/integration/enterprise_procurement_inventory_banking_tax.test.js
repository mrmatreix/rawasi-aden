const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { query, get, run } = require('../../server/database/db');

const ProcurementService = require('../../server/services/procurementService');
const InventoryValuationService = require('../../server/services/inventoryValuationService');
const BankReconciliationService = require('../../server/services/bankReconciliationService');
const TaxAndGuaranteeService = require('../../server/services/taxAndGuaranteeService');

test('Enterprise Accounting & Contracting Suite: Procurement, Valuation, Banking, and Yemeni Tax', async (t) => {
  const makerUser = { id: 1, username: 'admin', full_name: 'المدير العام', role: 'admin' };
  const checkerUser = { id: 2, username: 'finance_checker', full_name: 'مدير التدقيق المالي', role: 'finance_manager' };

  // لاحقة ثابتة معزولة (بدل الطابع الزمني) — تتيح التنظيف القبلي/البعدي بمفاتيح دقيقة
  // وتمنع تصادم المفاتيح الفريدة بين التشغيلات (كان CHQ-xxxxxx يتصادم سابقاً)
  const testSuffix = 'ENTFIX';
  const CLIENT_NAME = `شركة الأفق العقارية - ${testSuffix}`;
  const SUPP_NAME = `مؤسسة النصر لمواد البناء - ${testSuffix}`;
  const SUPP2_NAME = `مؤسسة الاتحاد للتوريدات - ${testSuffix}`;
  const PROJ_NAME = `مشروع برج الرقابة المالية المتكامل - ${testSuffix}`;
  const ITEM_CODE = `ITM-TEST-${testSuffix}`;
  const BILL_NO = `IPC-TAX-${testSuffix}`;
  const CHEQUE_NO = `CHQ-${testSuffix}`;
  const LG_NO = `LG-PB-${testSuffix}`;

  let testProjectId, testSupplierId, testSupplier2Id, testClientId, testItemId, testBoqId;
  let prId, rfqId, poId, grnId, stmtId, chequeId, billId, guaranteeId;
  // مُلتقطات التنظيف: معرفات الصفوف وأرقام القيود (قيد العمولة البنكية بلا أب — لا يُحل إلا برقمه)
  let transferId, retId, retJeNo, adjId, adjJeNo, chargeJeNo, bounceJeNo, taxJeNo, lgJeNo, relJeNo, brsId;
  // رصيد البنك 1 قبل التشغيل (الكيان الحقيقي الوحيد المتأثر: −25k عمولة −1.05M هامش +1M استرداد)
  let bank1Before = null;

  // تنظيف معزول: قبلي (صفوف ثابتة المفاتيح من تشغيل متقطع) + بعدي شامل
  // القيود تُحل من journal_entry_id في الآباء + أرقام القيود الملتقطة — بلا كنس تاريخي
  const cleanup = async () => {
    const idSet = async (sql, params = []) => new Set((await query(sql, params)).map(r => r.id));
    const withCaptured = (s, v) => { if (v) s.add(Number(v)); return s; };
    const ph = (s) => [...s].map(() => '?').join(',');

    const projIds = withCaptured(await idSet('SELECT id FROM projects WHERE name = ?', [PROJ_NAME]), testProjectId);
    const itemIds = withCaptured(await idSet('SELECT id FROM items WHERE code = ?', [ITEM_CODE]), testItemId);
    const clientIds = withCaptured(await idSet('SELECT id FROM clients WHERE name = ?', [CLIENT_NAME]), testClientId);
    const suppIds = withCaptured(await idSet('SELECT id FROM suppliers WHERE name IN (?, ?)', [SUPP_NAME, SUPP2_NAME]), testSupplierId);
    withCaptured(suppIds, testSupplier2Id);
    const billIds = withCaptured(await idSet('SELECT id FROM bills WHERE bill_no = ?', [BILL_NO]), billId);
    const chqIds = withCaptured(await idSet('SELECT id FROM cheques WHERE cheque_no = ?', [CHEQUE_NO]), chequeId);
    const lgIds = withCaptured(await idSet('SELECT id FROM bank_guarantees WHERE guarantee_no = ?', [LG_NO]), guaranteeId);
    // الكشف البنكي غير مربوط بكيان اختباري — بصمته القيم الدقيقة + سطراه المعروفان
    const stmtRows = await query(
      `SELECT s.id FROM bank_statements s
       WHERE s.bank_account_id = 1 AND s.statement_date = '2026-09-24'
         AND s.opening_balance = 50000000 AND s.closing_balance = 54500000
         AND EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.statement_id = s.id AND l.description = 'إيداع نقدي محصل من عميل')
         AND EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.statement_id = s.id AND l.description = 'عمولة تحويل بنكي سريع')`
    );
    const stmtIds = withCaptured(new Set(stmtRows.map(r => r.id)), stmtId);

    const prIds = withCaptured(new Set(), prId);
    const poIds = withCaptured(new Set(), poId);
    const grnIds = withCaptured(new Set(), grnId);
    const rfqIds = withCaptured(new Set(), rfqId);
    if (projIds.size > 0) {
      for (const r of await query(`SELECT id FROM purchase_requisitions WHERE project_id IN (${ph(projIds)})`, [...projIds])) prIds.add(r.id);
      for (const r of await query(`SELECT id FROM purchase_orders WHERE project_id IN (${ph(projIds)})`, [...projIds])) poIds.add(r.id);
      for (const r of await query(`SELECT id FROM goods_receipt_notes WHERE project_id IN (${ph(projIds)})`, [...projIds])) grnIds.add(r.id);
    }
    if (prIds.size > 0) {
      for (const r of await query(`SELECT id FROM rfqs WHERE requisition_id IN (${ph(prIds)})`, [...prIds])) rfqIds.add(r.id);
    }

    // 1. القيود: من الآباء أولاً ثم الملتقطة (إزالة تكرار بالمجموعة)
    const jeIds = new Set();
    const collectJe = async (table, col, idSetV, extraCols = []) => {
      if (idSetV.size === 0) return;
      const cols = ['journal_entry_id', ...extraCols].join(', ');
      const rows = await query(`SELECT ${cols} FROM ${table} WHERE ${col} IN (${ph(idSetV)})`, [...idSetV]);
      for (const r of rows) for (const c of ['journal_entry_id', ...extraCols]) if (r[c]) jeIds.add(Number(r[c]));
    };
    if (projIds.size > 0) {
      const rets = await query(`SELECT id, journal_entry_id FROM inventory_returns WHERE project_id IN (${ph(projIds)})`, [...projIds]);
      for (const r of rets) { if (r.journal_entry_id) jeIds.add(Number(r.journal_entry_id)); }
    }
    if (retId) {
      const rr = await get('SELECT journal_entry_id FROM inventory_returns WHERE id = ?', [Number(retId)]);
      if (rr && rr.journal_entry_id) jeIds.add(Number(rr.journal_entry_id));
    }
    await collectJe('inventory_adjustments', 'id', withCaptured(new Set(), adjId));
    if (itemIds.size > 0) {
      const adjs = await query(`SELECT journal_entry_id FROM inventory_adjustments WHERE item_id IN (${ph(itemIds)})`, [...itemIds]);
      for (const r of adjs) if (r.journal_entry_id) jeIds.add(Number(r.journal_entry_id));
    }
    await collectJe('cheques', 'id', chqIds);
    await collectJe('bills', 'id', billIds);
    await collectJe('bank_guarantees', 'id', lgIds, ['release_journal_entry_id']);
    if (billIds.size > 0) {
      const whs = await query(`SELECT journal_entry_id FROM tax_withholdings WHERE source_doc_type = 'bill' AND source_doc_id IN (${ph(billIds)})`, [...billIds]);
      for (const r of whs) if (r.journal_entry_id) jeIds.add(Number(r.journal_entry_id));
    }
    const jeNos = [retJeNo, adjJeNo, chargeJeNo, bounceJeNo, taxJeNo, lgJeNo, relJeNo].filter(Boolean);
    if (jeNos.length > 0) {
      const rows = await query(`SELECT id FROM journal_entries WHERE entry_no IN (${jeNos.map(() => '?').join(',')})`, jeNos);
      for (const r of rows) jeIds.add(Number(r.id));
    }
    // شبكة أمان: أي قيد يمس مشروع الاختبار (يلتقط بقايا جزئية بلا آباء ولا التقطات)
    if (projIds.size > 0) {
      const touched = await query(`SELECT DISTINCT entry_id AS id FROM journal_entry_lines WHERE project_id IN (${ph(projIds)})`, [...projIds]);
      for (const r of touched) jeIds.add(Number(r.id));
    }
    // سطور القيود أولاً (بعضها يشير للمشروع — لا شيء يشير إليها)
    if (jeIds.size > 0) {
      await run(`DELETE FROM journal_entry_lines WHERE entry_id IN (${ph(jeIds)})`, [...jeIds]);
    }
    // (حذف رؤوس القيود في الخطوة 3 — بعد صفوف الأعمال التي تشير إليها عبر journal_entry_id)

    // 2. الأوراق والأبناء (الأحفاد قبل الآباء)
    if (billIds.size > 0) {
      await run(`DELETE FROM tax_withholdings WHERE source_doc_type = 'bill' AND source_doc_id IN (${ph(billIds)})`, [...billIds]);
    }
    if (stmtIds.size > 0) {
      await run(`DELETE FROM bank_statement_lines WHERE statement_id IN (${ph(stmtIds)})`, [...stmtIds]);
      await run(`DELETE FROM bank_reconciliations WHERE statement_id IN (${ph(stmtIds)})`, [...stmtIds]);
      await run(`DELETE FROM bank_statements WHERE id IN (${ph(stmtIds)})`, [...stmtIds]);
    }
    if (brsId) await run('DELETE FROM bank_reconciliations WHERE id = ?', [Number(brsId)]);
    if (chqIds.size > 0) await run(`DELETE FROM cheques WHERE id IN (${ph(chqIds)})`, [...chqIds]);
    if (lgIds.size > 0) {
      // عكس أثر الضمانات القديمة على البنك من بيانات صفوفها (قبلي فقط — البعدي يستعيد اللقطة)
      if (bank1Before === null) {
        const rows = await query(`SELECT cash_margin_amount, commission_fee, status FROM bank_guarantees WHERE id IN (${ph(lgIds)})`, [...lgIds]);
        let restore = 0;
        for (const g of rows) {
          restore += (Number(g.cash_margin_amount) || 0) + (Number(g.commission_fee) || 0);
          if ((g.status || '') === 'released') restore -= (Number(g.cash_margin_amount) || 0);
        }
        if (Math.abs(restore) > 0.005) {
          await run('UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = 1', [restore]);
        }
      }
      await run(`DELETE FROM bank_guarantees WHERE id IN (${ph(lgIds)})`, [...lgIds]);
    }
    if (billIds.size > 0) await run(`DELETE FROM bills WHERE id IN (${ph(billIds)})`, [...billIds]);
    // طبقات التقييم قبل أذون الاستلام (تشير إليها عبر grn_id)
    if (itemIds.size > 0) await run(`DELETE FROM inventory_valuation_layers WHERE item_id IN (${ph(itemIds)})`, [...itemIds]);
    if (grnIds.size > 0) {
      await run(`DELETE FROM goods_receipt_items WHERE grn_id IN (${ph(grnIds)})`, [...grnIds]);
      await run(`DELETE FROM goods_receipt_notes WHERE id IN (${ph(grnIds)})`, [...grnIds]);
    }
    if (poIds.size > 0) {
      await run(`DELETE FROM purchase_order_items WHERE po_id IN (${ph(poIds)})`, [...poIds]);
      await run(`DELETE FROM purchase_orders WHERE id IN (${ph(poIds)})`, [...poIds]);
    }
    if (rfqIds.size > 0) {
      await run(`DELETE FROM rfq_vendor_quotes WHERE rfq_id IN (${ph(rfqIds)})`, [...rfqIds]);
      await run(`DELETE FROM rfqs WHERE id IN (${ph(rfqIds)})`, [...rfqIds]);
    }
    if (prIds.size > 0) {
      await run(`DELETE FROM purchase_requisition_items WHERE requisition_id IN (${ph(prIds)})`, [...prIds]);
      await run(`DELETE FROM purchase_requisitions WHERE id IN (${ph(prIds)})`, [...prIds]);
    }
    if (itemIds.size > 0) {
      await run(`DELETE FROM inventory_transactions WHERE item_id IN (${ph(itemIds)})`, [...itemIds]);
      await run(`DELETE FROM inventory_transfers WHERE item_id IN (${ph(itemIds)})`, [...itemIds]);
      await run(`DELETE FROM inventory_adjustments WHERE item_id IN (${ph(itemIds)})`, [...itemIds]);
      await run(`DELETE FROM warehouse_stocks WHERE item_id IN (${ph(itemIds)})`, [...itemIds]);
    }
    if (transferId) await run('DELETE FROM inventory_transfers WHERE id = ?', [Number(transferId)]);
    if (retId) await run('DELETE FROM inventory_returns WHERE id = ?', [Number(retId)]);
    if (projIds.size > 0) {
      await run(`DELETE FROM inventory_returns WHERE project_id IN (${ph(projIds)})`, [...projIds]);
      await run(`DELETE FROM project_boq WHERE project_id IN (${ph(projIds)})`, [...projIds]);
    }
    if (itemIds.size > 0) await run(`DELETE FROM items WHERE id IN (${ph(itemIds)})`, [...itemIds]);
    if (projIds.size > 0) await run(`DELETE FROM projects WHERE id IN (${ph(projIds)})`, [...projIds]);
    if (clientIds.size > 0) await run(`DELETE FROM clients WHERE id IN (${ph(clientIds)})`, [...clientIds]);
    if (suppIds.size > 0) await run(`DELETE FROM suppliers WHERE id IN (${ph(suppIds)})`, [...suppIds]);

    // 3. رؤوس القيود — بعد زوال كل صف يشير إليها
    if (jeIds.size > 0) {
      await run(`DELETE FROM journal_entries WHERE id IN (${ph(jeIds)})`, [...jeIds]);
    }

    // 4. البنك 1: استعادة اللقطة بعدياً (القيمة الملتقطة قبل التشغيل)
    if (bank1Before !== null) {
      await run('UPDATE bank_accounts SET current_balance = ? WHERE id = 1', [bank1Before]);
    }
  };
  t.after(() => cleanup().catch((e) => { console.error("CLEANUP-FAIL:", e.message); }));
  await cleanup();

  // لقطة رصيد البنك 1 بعد التنظيف القبلي (أساس الاستعادة البعدية)
  try {
    const b1 = await get('SELECT current_balance FROM bank_accounts WHERE id = 1');
    bank1Before = b1 ? Number(b1.current_balance) : null;
  } catch { bank1Before = null; }

  before(async () => {
    // 1. عميل ومورد
    const clientRes = await run(`
      INSERT INTO clients (name, company, phone, current_balance, tax_number)
      VALUES (?, 'مجموعة الأفق', '770000001', 0, ?)
    `, [`شركة الأفق العقارية - ${testSuffix}`, `TIN-CLI-${testSuffix}`]);
    testClientId = clientRes.lastInsertRowid || clientRes.insertId;

    const suppRes = await run(`
      INSERT INTO suppliers (name, category, balance, tax_number)
      VALUES (?, 'حديد وأسمنت', 0, ?)
    `, [`مؤسسة النصر لمواد البناء - ${testSuffix}`, `TIN-SUP-${testSuffix}`]);
    testSupplierId = suppRes.lastInsertRowid || suppRes.insertId;

    const supp2Res = await run(`
      INSERT INTO suppliers (name, category, balance, tax_number)
      VALUES (?, 'حديد وأسمنت', 0, ?)
    `, [`مؤسسة الاتحاد للتوريدات - ${testSuffix}`, `TIN-SUP2-${testSuffix}`]);
    testSupplier2Id = supp2Res.lastInsertRowid || supp2Res.insertId;

    // 2. مشروع وبند جدول كميات BOQ
    const projRes = await run(`
      INSERT INTO projects (name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, status)
      VALUES (?, ?, 100000000, 70000000, 0, 0, 'active')
    `, [`مشروع برج الرقابة المالية المتكامل - ${testSuffix}`, testClientId]);
    testProjectId = projRes.lastInsertRowid || projRes.insertId;

    const boqRes = await run(`
      INSERT INTO project_boq (project_id, item_no, description, category, unit, contract_qty, unit_rate, total_amount)
      VALUES (?, '02-01', 'أعمال خرسانة مسلحة للأساسات والقواعد', 'أعمال خرسانية', 'م3', 500, 10000, 5000000)
    `, [testProjectId]);
    testBoqId = boqRes.lastInsertRowid || boqRes.insertId;

    // 3. صنف مخزني فريد
    const itemRes = await run(`
      INSERT INTO items (code, name, category, unit, min_quantity, current_quantity, unit_price, reorder_level, safety_stock)
      VALUES (?, ?, 'حديد', 'طن', 10, 50, 650000, 15, 5)
    `, [`ITM-TEST-${testSuffix}`, `حديد تسليح تركي 16 ملم - ${testSuffix}`]);
    testItemId = itemRes.lastInsertRowid || itemRes.insertId;

    // تهيئة رصيد المستودع الأولي للصنف
    await run(`
      INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
      VALUES (1, ?, 50, 650000, 650000)
      ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = 50
    `, [testItemId]);

    // التأكد من تهيئة رصيد مستودع الموقع (المستودع 2) للصنف برصيد 0
    await run(`
      INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost)
      VALUES (2, ?, 0, 650000, 650000)
      ON CONFLICT(warehouse_id, item_id) DO UPDATE SET quantity = 0
    `, [testItemId]);
  });

  // =========================================================================
  // المحور الأول: دورة المشتريات والمطابقة الثلاثية (Procurement & 3-Way Match)
  // =========================================================================
  await t.test('1.1. Create Purchase Requisition (PR) with BOQ binding', async () => {
    const pr = await ProcurementService.createRequisition({
      project_id: testProjectId,
      boq_item_id: testBoqId,
      department: 'الهندسة الميدانية',
      required_date: '2026-10-01',
      urgency: 'عاجل',
      items: [
        { item_id: testItemId, item_name: 'حديد تسليح تركي 16 ملم', unit: 'طن', quantity: 20, estimated_price: 650000 }
      ],
      user: makerUser
    });

    assert.ok(pr.pr_no.startsWith('PR-'));
    assert.equal(pr.status, 'draft');
    assert.equal(pr.estimated_total, 13000000);
    prId = pr.id;
  });

  await t.test('1.2. PR Approval enforces Maker-Checker (Rejects self-approval, accepts checker)', async () => {
    await assert.rejects(
      async () => {
        await ProcurementService.approveRequisition(prId, makerUser, null, 'محاولة اعتماد ذاتي');
      },
      /الرقابة الثنائية/
    );

    const approvedPr = await ProcurementService.approveRequisition(prId, checkerUser, null, 'معتمد وفق جدول الكميات');
    assert.equal(approvedPr.status, 'approved');
  });

  await t.test('1.3. RFQ Creation and Multi-Vendor Price Comparison Matrix', async () => {
    const rfq = await ProcurementService.createRFQ({
      requisition_id: prId,
      title: 'توريد حديد تسليح للمشروع',
      closing_date: '2026-10-05',
      vendor_quotes: [
        { supplier_id: testSupplierId, total_price: 12800000, delivery_days: 2, quote_reference: 'Q-NASR-01' },
        { supplier_id: testSupplier2Id, total_price: 13200000, delivery_days: 4, quote_reference: 'Q-OTHER-02' }
      ],
      user: makerUser
    });

    assert.equal(rfq.status, 'evaluated');
    assert.equal(rfq.winner_supplier_id, testSupplierId);
    assert.equal(rfq.winner_quote_amount, 12800000);
    rfqId = rfq.id;
  });

  await t.test('1.4. Purchase Order (PO) creation and Maker-Checker approval', async () => {
    const po = await ProcurementService.createPurchaseOrder({
      requisition_id: prId,
      rfq_id: rfqId,
      supplier_id: testSupplierId,
      project_id: testProjectId,
      warehouse_id: 1,
      items: [
        { item_id: testItemId, item_name: 'حديد تسليح تركي 16 ملم', unit: 'طن', ordered_qty: 20, unit_price: 640000 }
      ],
      user: makerUser
    });

    assert.ok(po.po_no.startsWith('PO-'));
    assert.equal(po.total_amount, 12800000);
    poId = po.id;

    await assert.rejects(
      async () => {
        await ProcurementService.approvePurchaseOrder(poId, makerUser);
      },
      /الرقابة الثنائية/
    );

    const approvedPo = await ProcurementService.approvePurchaseOrder(poId, checkerUser);
    assert.equal(approvedPo.status, 'approved');
  });

  await t.test('1.5. Goods Receipt Note (GRN) material inspection and warehouse stock update', async () => {
    const grn = await ProcurementService.createGoodsReceiptNote({
      po_id: poId,
      supplier_id: testSupplierId,
      project_id: testProjectId,
      warehouse_id: 1,
      delivery_note_no: 'DN-99441',
      receiver_name: 'أمين المستودع الرئيسي',
      inspector_name: 'مهندس الجودة والسلامة',
      inspection_status: 'accepted',
      items: [
        {
          item_id: testItemId,
          item_name: 'حديد تسليح تركي 16 ملم',
          unit: 'طن',
          received_qty: 20,
          accepted_qty: 20,
          rejected_qty: 0,
          unit_cost: 640000,
          batch_number: `LOT-${testSuffix}`
        }
      ],
      user: makerUser
    });

    assert.ok(grn.grn_no.startsWith('GRN-'));
    assert.equal(grn.po_status, 'received');
    grnId = grn.id;

    // التأكد من زيادة كمية المخزون (50 السابقة + 20 المستلمة = 70)
    const updatedItem = await get('SELECT current_quantity FROM items WHERE id = ?', [testItemId]);
    assert.equal(Number(updatedItem.current_quantity), 70);
  });

  await t.test('1.6. Three-Way Matching: Blocks quantity variance', async () => {
    const matchRes = await ProcurementService.executeThreeWayMatch({
      po_id: poId,
      grn_id: grnId,
      invoice_amount: 16000000,
      invoice_items: [
        { item_id: testItemId, item_name: 'حديد تسليح تركي 16 ملم', quantity: 25, unit_price: 640000 }
      ],
      user: checkerUser
    });

    assert.equal(matchRes.isMatch, false);
    assert.equal(matchRes.status, 'qty_variance_blocked');
    assert.ok(matchRes.discrepancies.some(d => d.includes('فارق في الكمية')));
  });

  await t.test('1.7. Three-Way Matching: Blocks price variance above agreed PO rate', async () => {
    const matchRes = await ProcurementService.executeThreeWayMatch({
      po_id: poId,
      grn_id: grnId,
      invoice_amount: 13600000,
      invoice_items: [
        { item_id: testItemId, item_name: 'حديد تسليح تركي 16 ملم', quantity: 20, unit_price: 680000 }
      ],
      user: checkerUser
    });

    assert.equal(matchRes.isMatch, false);
    assert.equal(matchRes.status, 'price_variance_blocked');
    assert.ok(matchRes.discrepancies.some(d => d.includes('فارق في السعر')));
  });

  await t.test('1.8. Three-Way Matching: Successful match within tolerance', async () => {
    const matchRes = await ProcurementService.executeThreeWayMatch({
      po_id: poId,
      grn_id: grnId,
      invoice_amount: 12800000,
      invoice_items: [
        { item_id: testItemId, item_name: 'حديد تسليح تركي 16 ملم', quantity: 20, unit_price: 640000 }
      ],
      tolerance_pct: 0.0,
      user: checkerUser
    });

    assert.equal(matchRes.isMatch, true);
    assert.equal(matchRes.status, 'matched');
    assert.equal(matchRes.discrepancies.length, 0);
  });

  // =========================================================================
  // المحور الثاني: تقييم المخزون والمستودعات المتعددة (Inventory & Valuation)
  // =========================================================================
  await t.test('2.1. Strict Negative Stock Barrier prevents overdraft', async () => {
    await assert.rejects(
      async () => {
        await InventoryValuationService.assertNoNegativeStock(1, testItemId, 100);
      },
      /حظر الرصيد السالب/
    );
  });

  await t.test('2.2. Inter-Warehouse Stock Transfer (From Central to Site Warehouse)', async () => {
    const trf = await InventoryValuationService.transferStock({
      from_warehouse_id: 1,
      to_warehouse_id: 2,
      item_id: testItemId,
      quantity: 15,
      user: makerUser
    });

    assert.ok(trf.transfer_no.startsWith('TRF-'));
    assert.equal(trf.status, 'completed');
    transferId = trf.id;

    const wh1 = await get('SELECT quantity FROM warehouse_stocks WHERE warehouse_id = 1 AND item_id = ?', [testItemId]);
    const wh2 = await get('SELECT quantity FROM warehouse_stocks WHERE warehouse_id = 2 AND item_id = ?', [testItemId]);

    assert.equal(Number(wh1.quantity), 55); // 70 - 15 = 55
    assert.equal(Number(wh2.quantity), 15); // 0 + 15 = 15
  });

  await t.test('2.3. Material Issuance bound to BOQ item and project cost update', async () => {
    const issue = await InventoryValuationService.issueMaterialWithBOQBinding({
      project_id: testProjectId,
      boq_item_id: testBoqId,
      warehouse_id: 2,
      item_id: testItemId,
      quantity: 10,
      recipient: 'المهندس المشرف على الأساسات',
      user: makerUser
    });

    assert.ok(issue.reference_no.startsWith('MAT-BOQ-'));
    assert.equal(issue.status, 'posted');

    const updatedProj = await get('SELECT actual_cost FROM projects WHERE id = ?', [testProjectId]);
    assert.ok(Number(updatedProj.actual_cost) > 0);
  });

  await t.test('2.4. Project Material Return credits project cost and increases stock', async () => {
    const initialProj = await get('SELECT actual_cost FROM projects WHERE id = ?', [testProjectId]);
    const initialCost = Number(initialProj.actual_cost);

    const ret = await InventoryValuationService.processProjectReturn({
      project_id: testProjectId,
      warehouse_id: 2,
      item_id: testItemId,
      quantity: 2,
      unit_price: 650000,
      reason: 'فائض حديد تسليح بعد صب القواعد',
      user: makerUser
    });

    assert.ok(ret.return_no.startsWith('RET-PRJ-'));
    assert.ok(ret.journal_entry_no.startsWith('JV-'));
    retId = ret.id;
    retJeNo = ret.journal_entry_no;

    const afterProj = await get('SELECT actual_cost FROM projects WHERE id = ?', [testProjectId]);
    assert.equal(Number(afterProj.actual_cost), initialCost - 1300000);
  });

  await t.test('2.5. Stocktaking Deficit Adjustment generates balanced GL shrinkage entry', async () => {
    // رصيد المستودع 2 هو 7 طن (15 تم تحويلها - 10 صرف + 2 مرتجع = 7)
    // الجرد الفعلي وجد 6 طن (عجز 1 طن)
    const adj = await InventoryValuationService.processStocktakingAdjustment({
      warehouse_id: 2,
      item_id: testItemId,
      physical_qty: 6,
      reason: 'عجز ناتج عن فاقد قص وثني الحديد بالموقع',
      user: checkerUser
    });

    assert.equal(adj.diff_qty, -1);
    assert.equal(adj.adjustment_type, 'deficit');
    assert.ok(adj.journal_entry_no.startsWith('JV-'));
    adjId = adj.id;
    adjJeNo = adj.journal_entry_no;

    const jv = await get('SELECT total_debit, total_credit FROM journal_entries WHERE entry_no = ?', [adj.journal_entry_no]);
    assert.equal(Number(jv.total_debit), Number(jv.total_credit));
  });

  await t.test('2.6. Reorder Point Alerts identify critical and low stock items', async () => {
    const alerts = await InventoryValuationService.getReorderAlerts();
    assert.ok(Array.isArray(alerts.alerts));
  });

  // =========================================================================
  // المحور الثالث: التسوية البنكية ومحفظة الشيكات (Bank Reconciliation & Cheques)
  // =========================================================================
  await t.test('3.1. Import Bank Statement with debit and credit lines', async () => {
    const stmt = await BankReconciliationService.importBankStatement({
      bank_account_id: 1,
      statement_date: '2026-09-24',
      opening_balance: 50000000,
      closing_balance: 54500000,
      lines: [
        { description: 'إيداع نقدي محصل من عميل', credit: 5000000, debit: 0, balance: 55000000 },
        { description: 'عمولة تحويل بنكي سريع', credit: 0, debit: 500000, balance: 54500000 }
      ],
      user: makerUser
    });

    assert.ok(stmt.statement_id > 0);
    assert.equal(stmt.lines_count, 2);
    stmtId = stmt.statement_id;
  });

  await t.test('3.2. Record Bank Charges with balanced GL entry', async () => {
    const charge = await BankReconciliationService.recordBankCharge({
      bank_account_id: 1,
      amount: 25000,
      fee_type: 'رسوم كشف حساب سنوي',
      user: makerUser
    });

    assert.equal(charge.success, true);
    assert.ok(charge.entry_no.startsWith('JV-'));
    chargeJeNo = charge.entry_no;

    const jv = await get('SELECT total_debit, total_credit FROM journal_entries WHERE entry_no = ?', [charge.entry_no]);
    assert.equal(Number(jv.total_debit), 25000);
    assert.equal(Number(jv.total_credit), 25000);
  });

  await t.test('3.3. Cheque Portfolio management and Bounced Cheque Reversal', async () => {
    const chequeNo = `CHQ-${testSuffix}`;
    const chk = await BankReconciliationService.createCheque({
      cheque_no: chequeNo,
      type: 'received',
      bank_account_id: 1,
      drawer_name: 'شركة الأفق العقارية',
      beneficiary_name: 'شركة رواسي عدن',
      amount: 3000000,
      client_id: testClientId,
      user: makerUser
    });

    assert.equal(chk.cheque_no, chequeNo);
    assert.equal(chk.status, 'received');
    chequeId = chk.id;

    const bounce = await BankReconciliationService.processBouncedCheque(chequeId, {
      bounce_reason: 'عدم كفاية الرصيد لدى البنك المسحوب عليه',
      user: checkerUser
    });

    assert.equal(bounce.status, 'bounced');
    assert.ok(bounce.journal_entry_no.startsWith('JV-'));
    bounceJeNo = bounce.journal_entry_no;

    const updatedClient = await get('SELECT current_balance FROM clients WHERE id = ?', [testClientId]);
    assert.equal(Number(updatedClient.current_balance), 3000000);
  });

  await t.test('3.4. Monthly Bank Reconciliation Statement (BRS) calculation', async () => {
    const brs = await BankReconciliationService.generateBankReconciliationStatement(
      1,
      stmtId,
      '2026-09-24',
      checkerUser
    );

    assert.ok(brs.reconciliation_no.startsWith('BRS-'));
    assert.ok(typeof brs.adjusted_bank_balance === 'number');
    assert.ok(typeof brs.adjusted_book_balance === 'number');
    assert.ok(typeof brs.variance === 'number');
    brsId = brs.id;
  });

  // =========================================================================
  // المحور الرابع: الضرائب والخصم من المنبع والضمانات البنكية (Tax & Guarantees)
  // =========================================================================
  await t.test('4.1. Tax Configs include Yemeni Income Tax Law 17/2010 and legal disclaimer', async () => {
    const configs = await TaxAndGuaranteeService.getTaxConfigs();
    assert.ok(configs.legal_disclaimer.includes('قانون ضرائب الدخل اليمني رقم 17 لسنة 2010'));
    assert.ok(configs.configs.some(c => c.type === 'wht_contracting' && Number(c.rate_percentage) === 3.0));
  });

  await t.test('4.2. Process Bill Tax Deduction with compound balanced GL entry', async () => {
    const bill_no = `IPC-TAX-${testSuffix}`;

    const billRes = await run(`
      INSERT INTO bills (
        bill_no, project_id, client_id, gross_amount, amount, advance_deduction,
        retention_deduction, net_amount, status, date
      ) VALUES (?, ?, ?, 20000000, 20000000, 2000000, 2000000, 15400000, 'approved', '2026-09-24')
    `, [bill_no, testProjectId, testClientId]);
    billId = billRes.lastInsertRowid || billRes.insertId;

    const taxResult = await TaxAndGuaranteeService.processBillTaxDeduction(billId, 3.0, checkerUser);

    assert.equal(taxResult.gross_amount, 20000000);
    assert.equal(taxResult.tax_wht_rate, 3.0);
    assert.equal(taxResult.tax_wht_amount, 600000); // 3% من 20 مليون
    assert.equal(taxResult.net_amount, 15400000); // 20M - 2M - 2M - 0.6M = 15.4M
    assert.ok(taxResult.journal_entry_no.startsWith('JV-TAX-'));
    taxJeNo = taxResult.journal_entry_no;

    const jv = await get('SELECT total_debit, total_credit FROM journal_entries WHERE entry_no = ?', [taxResult.journal_entry_no]);
    assert.equal(Number(jv.total_debit), 20000000);
    assert.equal(Number(jv.total_credit), 20000000);
  });

  await t.test('4.3. Periodic Tax Declaration report aggregates WHT certificates', async () => {
    // فترة الفاتورة الثابتة في 4.2 — لا الشهر الجاري (كان يقلب مع التقويم في 2026-10)
    const currentPeriod = '2026-09';
    const dec = await TaxAndGuaranteeService.getTaxDeclarationReport(currentPeriod);

    assert.equal(dec.tax_period, currentPeriod);
    assert.ok(dec.summary.total_wht_deducted_by_clients >= 600000);
    assert.ok(dec.client_withholdings.length >= 1);
  });

  await t.test('4.4. Issue Bank Guarantee (Performance Bond) with Cash Margin GL entry', async () => {
    const guaranteeNo = `LG-PB-${testSuffix}`;
    const lg = await TaxAndGuaranteeService.issueBankGuarantee({
      guarantee_no: guaranteeNo,
      type: 'performance_bond',
      project_id: testProjectId,
      client_id: testClientId,
      issuing_bank: 'البنك الأهلي اليمني',
      bank_account_id: 1,
      amount: 10000000,
      cash_margin_pct: 10,
      commission_fee: 50000,
      issue_date: '2026-09-24',
      expiry_date: '2027-09-24',
      user: makerUser
    });

    assert.equal(lg.guarantee_no, guaranteeNo);
    assert.equal(lg.cash_margin_amount, 1000000);
    assert.equal(lg.commission_fee, 50000);
    assert.ok(lg.journal_entry_no.startsWith('JV-LG-'));
    guaranteeId = lg.id;
    lgJeNo = lg.journal_entry_no;

    const jv = await get('SELECT total_debit, total_credit FROM journal_entries WHERE entry_no = ?', [lg.journal_entry_no]);
    assert.equal(Number(jv.total_debit), 1050000);
    assert.equal(Number(jv.total_credit), 1050000);
  });

  await t.test('4.5. Release Bank Guarantee upon project completion and refund cash margin', async () => {
    const release = await TaxAndGuaranteeService.releaseBankGuarantee(guaranteeId, {
      release_date: '2026-09-24',
      user: checkerUser
    });

    assert.equal(release.status, 'released');
    assert.equal(release.refunded_margin, 1000000);
    assert.ok(release.journal_entry_no.startsWith('JV-REL-'));
    relJeNo = release.journal_entry_no;

    const jv = await get('SELECT total_debit, total_credit FROM journal_entries WHERE entry_no = ?', [release.journal_entry_no]);
    assert.equal(Number(jv.total_debit), 1000000);
    assert.equal(Number(jv.total_credit), 1000000);
  });
});
