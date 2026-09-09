const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');

// ============================================================================
// 0. ملخص شامل لجميع المتطلبات الـ 14 للمشروع المحدد
// ============================================================================
router.get('/:projectId/overview', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = get(`
      SELECT p.*, c.name as client_name, c.phone as client_phone, c.company as client_company
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [projectId]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const contract = get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]);
    const drawings = query('SELECT * FROM project_drawings WHERE project_id = ? ORDER BY id DESC', [projectId]);
    const boq = query('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [projectId]);
    const quotations = query('SELECT * FROM project_quotations WHERE project_id = ? ORDER BY id DESC', [projectId]);
    const budgets = query('SELECT * FROM project_budgets WHERE project_id = ? ORDER BY id ASC', [projectId]);
    const changeOrders = query('SELECT * FROM project_change_orders WHERE project_id = ? ORDER BY id DESC', [projectId]);
    const purchases = query('SELECT * FROM project_purchases WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const labor = query('SELECT * FROM project_labor_expenses WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const invoices = query('SELECT * FROM project_invoices WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const dailyReports = query('SELECT * FROM project_daily_reports WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const weeklyReports = query('SELECT * FROM project_weekly_reports WHERE project_id = ? ORDER BY date_to DESC, id DESC', [projectId]);
    const handovers = query('SELECT * FROM project_handover_minutes WHERE project_id = ? ORDER BY inspection_date DESC, id DESC', [projectId]);
    const correspondence = query('SELECT * FROM project_correspondence WHERE project_id = ? ORDER BY date DESC, id DESC', [projectId]);
    const settlement = get('SELECT * FROM project_final_settlements WHERE project_id = ?', [projectId]);

    // الإحصائيات التراكمية المباشرة
    const totalApprovedChangeOrders = changeOrders.filter(c => c.status === 'معتمد').reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const revisedContractValue = (Number(project.contract_value) || 0) + totalApprovedChangeOrders;
    const totalPurchasesAmount = purchases.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
    const totalLaborAmount = labor.reduce((sum, l) => sum + (Number(l.total_amount) || 0), 0);
    const totalInvoicesGross = invoices.reduce((sum, i) => sum + (Number(i.current_gross_amount) || Number(i.net_amount) || 0), 0);
    const totalInvoicesNet = invoices.reduce((sum, i) => sum + (Number(i.net_amount) || 0), 0);
    const totalBoqValue = boq.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);

    res.json({
      success: true,
      data: {
        project,
        stats: {
          originalContractValue: Number(project.contract_value) || 0,
          totalApprovedChangeOrders,
          revisedContractValue,
          totalPurchasesAmount,
          totalLaborAmount,
          totalInvoicesGross,
          totalInvoicesNet,
          totalBoqValue,
          drawingsCount: drawings.length,
          dailyReportsCount: dailyReports.length,
          weeklyReportsCount: weeklyReports.length,
          handoversCount: handovers.length,
          correspondenceCount: correspondence.length,
          hasContract: !!contract,
          hasSettlement: !!settlement
        },
        contract,
        drawings,
        boq,
        quotations,
        budgets,
        changeOrders,
        purchases,
        labor,
        invoices,
        dailyReports,
        weeklyReports,
        handovers,
        correspondence,
        settlement
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المشروع الشاملة', error: err.message });
  }
});

// ============================================================================
// 1. عقد المشروع (Project Contract)
// ============================================================================
router.get('/:projectId/contract', (req, res) => {
  try {
    const contract = get('SELECT * FROM project_contracts WHERE project_id = ?', [req.params.projectId]);
    res.json({ success: true, data: contract });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/contract', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      contract_no, title, first_party, second_party, contract_date,
      start_date, end_date, duration_days, contract_value, currency,
      advance_payment_pct, advance_payment_amount, retention_pct,
      penalty_per_day, max_penalty_pct, payment_terms, scope_of_work,
      status, notes
    } = req.body;

    const existing = get('SELECT id FROM project_contracts WHERE project_id = ?', [projectId]);

    if (existing) {
      run(`
        UPDATE project_contracts SET
          contract_no = ?, title = ?, first_party = ?, second_party = ?,
          contract_date = ?, start_date = ?, end_date = ?, duration_days = ?,
          contract_value = ?, currency = ?, advance_payment_pct = ?, advance_payment_amount = ?,
          retention_pct = ?, penalty_per_day = ?, max_penalty_pct = ?,
          payment_terms = ?, scope_of_work = ?, status = ?, notes = ?
        WHERE project_id = ?
      `, [
        contract_no, title, first_party, second_party,
        contract_date, start_date, end_date, duration_days || 0,
        Number(contract_value) || 0, currency || 'ر.ي',
        Number(advance_payment_pct) || 0, Number(advance_payment_amount) || 0,
        Number(retention_pct) || 10, Number(penalty_per_day) || 0, Number(max_penalty_pct) || 10,
        payment_terms, scope_of_work, status || 'ساري', notes, projectId
      ]);
    } else {
      run(`
        INSERT INTO project_contracts (
          project_id, contract_no, title, first_party, second_party,
          contract_date, start_date, end_date, duration_days,
          contract_value, currency, advance_payment_pct, advance_payment_amount,
          retention_pct, penalty_per_day, max_penalty_pct,
          payment_terms, scope_of_work, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId, contract_no || `CNT-${projectId}`, title, first_party, second_party,
        contract_date, start_date, end_date, duration_days || 0,
        Number(contract_value) || 0, currency || 'ر.ي',
        Number(advance_payment_pct) || 0, Number(advance_payment_amount) || 0,
        Number(retention_pct) || 10, Number(penalty_per_day) || 0, Number(max_penalty_pct) || 10,
        payment_terms, scope_of_work, status || 'ساري', notes
      ]);
    }

    // تحديث قيمة العقد وتواريخ المشروع في جدول المشاريع الأساسي
    if (contract_value) {
      run(`
        UPDATE projects SET 
          contract_value = ?,
          start_date = COALESCE(?, start_date),
          end_date = COALESCE(?, end_date)
        WHERE id = ?
      `, [Number(contract_value), start_date, end_date, projectId]);
    }

    const saved = get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]);
    res.json({ success: true, message: 'تم حفظ عقد المشروع وتحديث بياناته بنجاح', data: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حفظ العقد', error: err.message });
  }
});

// ============================================================================
// 2. المخططات الهندسية (Engineering Drawings)
// ============================================================================
router.get('/:projectId/drawings', (req, res) => {
  try {
    const drawings = query('SELECT * FROM project_drawings WHERE project_id = ? ORDER BY id DESC', [req.params.projectId]);
    res.json({ success: true, data: drawings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/drawings', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      drawing_no, title, category = 'معماري', scale = '1:100', revision = 'Rev 0',
      submission_date, approval_date, status = 'معتمد', engineer_name, file_name, notes
    } = req.body;

    if (!drawing_no || !title) {
      return res.status(400).json({ success: false, message: 'رقم المخطط وعنوانه مطلوبان' });
    }

    const result = run(`
      INSERT INTO project_drawings (
        project_id, drawing_no, title, category, scale, revision,
        submission_date, approval_date, status, engineer_name, file_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, drawing_no, title, category, scale, revision,
      submission_date, approval_date, status, engineer_name, file_name, notes
    ]);

    const created = get('SELECT * FROM project_drawings WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تمت إضافة المخطط الهندسي بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إضافة المخطط', error: err.message });
  }
});

router.put('/:projectId/drawings/:id', (req, res) => {
  try {
    const {
      drawing_no, title, category, scale, revision,
      submission_date, approval_date, status, engineer_name, file_name, notes
    } = req.body;

    run(`
      UPDATE project_drawings SET
        drawing_no = COALESCE(?, drawing_no),
        title = COALESCE(?, title),
        category = COALESCE(?, category),
        scale = COALESCE(?, scale),
        revision = COALESCE(?, revision),
        submission_date = COALESCE(?, submission_date),
        approval_date = COALESCE(?, approval_date),
        status = COALESCE(?, status),
        engineer_name = COALESCE(?, engineer_name),
        file_name = COALESCE(?, file_name),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [
      drawing_no, title, category, scale, revision,
      submission_date, approval_date, status, engineer_name, file_name, notes,
      req.params.id, req.params.projectId
    ]);

    res.json({ success: true, message: 'تم تعديل المخطط الهندسي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/drawings/:id', (req, res) => {
  try {
    run('DELETE FROM project_drawings WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المخطط بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 3. جدول الكميات BOQ (Bill of Quantities)
// ============================================================================
router.get('/:projectId/boq', (req, res) => {
  try {
    const boq = query('SELECT * FROM project_boq WHERE project_id = ? ORDER BY id ASC', [req.params.projectId]);
    res.json({ success: true, data: boq });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/boq', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      item_no, description, category = 'أعمال خرسانية', unit = 'م3',
      contract_qty = 0, executed_qty = 0, unit_rate = 0, status = 'جاري التنفيذ', notes
    } = req.body;

    if (!item_no || !description) {
      return res.status(400).json({ success: false, message: 'رقم البند ووصف الأعمال مطلوبان' });
    }

    const cQty = Number(contract_qty) || 0;
    const rate = Number(unit_rate) || 0;
    const total = cQty * rate;

    const result = run(`
      INSERT INTO project_boq (
        project_id, item_no, description, category, unit,
        contract_qty, executed_qty, unit_rate, total_amount, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, item_no, description, category, unit,
      cQty, Number(executed_qty) || 0, rate, total, status, notes
    ]);

    const created = get('SELECT * FROM project_boq WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تمت إضافة بند جدول الكميات بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إضافة بند BOQ', error: err.message });
  }
});

router.put('/:projectId/boq/:id', (req, res) => {
  try {
    const {
      item_no, description, category, unit,
      contract_qty, executed_qty, unit_rate, status, notes
    } = req.body;

    const existing = get('SELECT * FROM project_boq WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    if (!existing) return res.status(404).json({ success: false, message: 'البند غير موجود' });

    const cQty = contract_qty !== undefined ? Number(contract_qty) : existing.contract_qty;
    const rate = unit_rate !== undefined ? Number(unit_rate) : existing.unit_rate;
    const total = cQty * rate;

    run(`
      UPDATE project_boq SET
        item_no = COALESCE(?, item_no),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        contract_qty = ?,
        executed_qty = COALESCE(?, executed_qty),
        unit_rate = ?,
        total_amount = ?,
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [
      item_no, description, category, unit,
      cQty, executed_qty !== undefined ? Number(executed_qty) : null,
      rate, total, status, notes, req.params.id, req.params.projectId
    ]);

    res.json({ success: true, message: 'تم تحديث بند جدول الكميات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/boq/:id', (req, res) => {
  try {
    run('DELETE FROM project_boq WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف البند بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. عروض الأسعار (Quotations & Price Offers)
// ============================================================================
router.get('/:projectId/quotations', (req, res) => {
  try {
    const quotations = query(`
      SELECT q.*, c.name as client_name, c.company as client_company
      FROM project_quotations q
      LEFT JOIN clients c ON q.client_id = c.id
      WHERE q.project_id = ? OR q.project_id IS NULL
      ORDER BY q.id DESC
    `, [req.params.projectId]);
    res.json({ success: true, data: quotations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/quotations', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      quotation_no, client_id, title, date, valid_until,
      items_json, subtotal = 0, discount = 0, tax_vat = 0, total_amount = 0,
      currency = 'ر.ي', payment_terms, delivery_period, status = 'مسودة', notes
    } = req.body;

    const countRes = get('SELECT COUNT(*) as cnt FROM project_quotations');
    const autoNo = quotation_no || `QUO-2024-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = run(`
      INSERT INTO project_quotations (
        project_id, client_id, quotation_no, title, date, valid_until,
        items_json, subtotal, discount, tax_vat, total_amount,
        currency, payment_terms, delivery_period, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, client_id ? Number(client_id) : null, autoNo, title, date || new Date().toISOString().split('T')[0],
      valid_until, typeof items_json === 'object' ? JSON.stringify(items_json) : items_json,
      Number(subtotal) || 0, Number(discount) || 0, Number(tax_vat) || 0, Number(total_amount) || 0,
      currency, payment_terms, delivery_period, status, notes
    ]);

    const created = get('SELECT * FROM project_quotations WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ عرض السعر بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء عرض السعر', error: err.message });
  }
});

router.put('/:projectId/quotations/:id', (req, res) => {
  try {
    const {
      title, client_id, date, valid_until, items_json,
      subtotal, discount, tax_vat, total_amount, currency,
      payment_terms, delivery_period, status, notes
    } = req.body;

    run(`
      UPDATE project_quotations SET
        title = COALESCE(?, title),
        client_id = COALESCE(?, client_id),
        date = COALESCE(?, date),
        valid_until = COALESCE(?, valid_until),
        items_json = COALESCE(?, items_json),
        subtotal = COALESCE(?, subtotal),
        discount = COALESCE(?, discount),
        tax_vat = COALESCE(?, tax_vat),
        total_amount = COALESCE(?, total_amount),
        currency = COALESCE(?, currency),
        payment_terms = COALESCE(?, payment_terms),
        delivery_period = COALESCE(?, delivery_period),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `, [
      title, client_id, date, valid_until,
      typeof items_json === 'object' ? JSON.stringify(items_json) : items_json,
      subtotal, discount, tax_vat, total_amount, currency,
      payment_terms, delivery_period, status, notes, req.params.id
    ]);

    res.json({ success: true, message: 'تم تحديث عرض السعر بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/quotations/:id', (req, res) => {
  try {
    run('DELETE FROM project_quotations WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'تم حذف عرض السعر بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 5. الميزانية والتكلفة المستهدفة (Budget & Target Cost)
// ============================================================================
router.get('/:projectId/budgets', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const budgets = query('SELECT * FROM project_budgets WHERE project_id = ? ORDER BY id ASC', [projectId]);
    res.json({ success: true, data: budgets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/budgets', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { category, planned_cost = 0, actual_cost = 0, notes } = req.body;

    if (!category) return res.status(400).json({ success: false, message: 'تصنيف الميزانية مطلوب' });

    const result = run(`
      INSERT INTO project_budgets (project_id, category, planned_cost, actual_cost, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [projectId, category, Number(planned_cost) || 0, Number(actual_cost) || 0, notes]);

    const created = get('SELECT * FROM project_budgets WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تمت إضافة مركز الميزانية بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:projectId/budgets/:id', (req, res) => {
  try {
    const { category, planned_cost, actual_cost, notes } = req.body;
    run(`
      UPDATE project_budgets SET
        category = COALESCE(?, category),
        planned_cost = COALESCE(?, planned_cost),
        actual_cost = COALESCE(?, actual_cost),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [category, planned_cost, actual_cost, notes, req.params.id, req.params.projectId]);

    res.json({ success: true, message: 'تم تحديث مركز الميزانية بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/budgets/:id', (req, res) => {
  try {
    run('DELETE FROM project_budgets WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف بند الميزانية بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 6. أوامر التغيير والإضافيات (Change Orders & Variations)
// ============================================================================
router.get('/:projectId/change-orders', (req, res) => {
  try {
    const orders = query('SELECT * FROM project_change_orders WHERE project_id = ? ORDER BY id DESC', [req.params.projectId]);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/change-orders', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      change_no, title, type = 'إضافة بند جديد', request_date, approval_date,
      amount = 0, time_extension_days = 0, reason = 'طلب المالك',
      status = 'معتمد', requested_by, approved_by, notes
    } = req.body;

    if (!title) return res.status(400).json({ success: false, message: 'عنوان أمر التغيير مطلوب' });

    const countRes = get('SELECT COUNT(*) as cnt FROM project_change_orders WHERE project_id = ?', [projectId]);
    const autoNo = change_no || `CO-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = run(`
      INSERT INTO project_change_orders (
        project_id, change_no, title, type, request_date, approval_date,
        amount, time_extension_days, reason, status, requested_by, approved_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, title, type, request_date || new Date().toISOString().split('T')[0],
      approval_date, Number(amount) || 0, Number(time_extension_days) || 0,
      reason, status, requested_by, approved_by, notes
    ]);

    const created = get('SELECT * FROM project_change_orders WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ أمر التغيير بنجاح وتحديث حسابات المشروع', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:projectId/change-orders/:id', (req, res) => {
  try {
    const {
      change_no, title, type, request_date, approval_date,
      amount, time_extension_days, reason, status, requested_by, approved_by, notes
    } = req.body;

    run(`
      UPDATE project_change_orders SET
        change_no = COALESCE(?, change_no),
        title = COALESCE(?, title),
        type = COALESCE(?, type),
        request_date = COALESCE(?, request_date),
        approval_date = COALESCE(?, approval_date),
        amount = COALESCE(?, amount),
        time_extension_days = COALESCE(?, time_extension_days),
        reason = COALESCE(?, reason),
        status = COALESCE(?, status),
        requested_by = COALESCE(?, requested_by),
        approved_by = COALESCE(?, approved_by),
        notes = COALESCE(?, notes)
      WHERE id = ? AND project_id = ?
    `, [
      change_no, title, type, request_date, approval_date,
      amount, time_extension_days, reason, status, requested_by, approved_by, notes,
      req.params.id, req.params.projectId
    ]);

    res.json({ success: true, message: 'تم تعديل أمر التغيير بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/change-orders/:id', (req, res) => {
  try {
    run('DELETE FROM project_change_orders WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف أمر التغيير بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 7. مشتريات وفواتير المشروع (Project Purchases)
// ============================================================================
router.get('/:projectId/purchases', (req, res) => {
  try {
    const purchases = query(`
      SELECT pp.*, s.name as supplier_full_name, s.phone as supplier_phone
      FROM project_purchases pp
      LEFT JOIN suppliers s ON pp.supplier_id = s.id
      WHERE pp.project_id = ?
      ORDER BY pp.date DESC, pp.id DESC
    `, [req.params.projectId]);
    res.json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/purchases', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      invoice_no, supplier_id, supplier_name, item_description,
      quantity = 1, unit, unit_price = 0, total_amount, paid_amount = 0,
      payment_status = 'مدفوع', payment_method = 'نقدي', date, receipt_no, notes
    } = req.body;

    if (!item_description) return res.status(400).json({ success: false, message: 'وصف المواد المشتراة مطلوب' });

    const qty = Number(quantity) || 1;
    const price = Number(unit_price) || 0;
    const total = total_amount ? Number(total_amount) : (qty * price);

    const result = run(`
      INSERT INTO project_purchases (
        project_id, invoice_no, supplier_id, supplier_name, item_description,
        quantity, unit, unit_price, total_amount, paid_amount,
        payment_status, payment_method, date, receipt_no, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, invoice_no, supplier_id ? Number(supplier_id) : null, supplier_name, item_description,
      qty, unit, price, total, Number(paid_amount) || 0,
      payment_status, payment_method, date || new Date().toISOString().split('T')[0], receipt_no, notes
    ]);

    // تسجيل مصروف آلي مرتبط بالمشروع إذا كان مدفوعاً
    if (Number(paid_amount) > 0) {
      const expReceipt = receipt_no || `EXP-PUR-${result.lastInsertRowid}`;
      run(`
        INSERT INTO expenses (receipt_no, expense_type, project_id, supplier_id, amount, payment_method, date, notes)
        VALUES (?, 'مواد بناء', ?, ?, ?, ?, ?, ?)
      `, [expReceipt, projectId, supplier_id ? Number(supplier_id) : null, Number(paid_amount), payment_method, date || new Date().toISOString().split('T')[0], `فاتورة مشتريات: ${item_description}`]);
    }

    const created = get('SELECT * FROM project_purchases WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ فاتورة المشتريات وتحديث تكلفة المشروع بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/purchases/:id', (req, res) => {
  try {
    run('DELETE FROM project_purchases WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف الفاتورة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 8. العمالة والمصروفات الميدانية (Labor & Site Expenses)
// ============================================================================
router.get('/:projectId/labor', (req, res) => {
  try {
    const labor = query('SELECT * FROM project_labor_expenses WHERE project_id = ? ORDER BY date DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: labor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/labor', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      date, worker_name_or_team, trade = 'نجار مسلح', workers_count = 1,
      daily_rate = 0, days_or_hours = 1, total_amount, expense_category = 'أجور عمالة',
      payment_status = 'مدفوع', supervisor_name, notes
    } = req.body;

    if (!worker_name_or_team) return res.status(400).json({ success: false, message: 'اسم العامل أو الطاقم مطلوب' });

    const count = Number(workers_count) || 1;
    const rate = Number(daily_rate) || 0;
    const days = Number(days_or_hours) || 1;
    const total = total_amount ? Number(total_amount) : (count * rate * days);

    const result = run(`
      INSERT INTO project_labor_expenses (
        project_id, date, worker_name_or_team, trade, workers_count,
        daily_rate, days_or_hours, total_amount, expense_category,
        payment_status, supervisor_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, date || new Date().toISOString().split('T')[0], worker_name_or_team, trade,
      count, rate, days, total, expense_category, payment_status, supervisor_name, notes
    ]);

    // تسجيل مصروف آلي في جدول المصروفات العام
    if (payment_status === 'مدفوع' && total > 0) {
      const expReceipt = `EXP-LAB-${result.lastInsertRowid}`;
      run(`
        INSERT INTO expenses (receipt_no, expense_type, project_id, amount, payment_method, date, notes)
        VALUES (?, 'أجور عمالة', ?, ?, 'نقدي', ?, ?)
      `, [expReceipt, projectId, total, date || new Date().toISOString().split('T')[0], `أجور ${trade}: ${worker_name_or_team}`]);
    }

    const created = get('SELECT * FROM project_labor_expenses WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم تسجيل أجور العمالة والمصروف الميداني بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/labor/:id', (req, res) => {
  try {
    run('DELETE FROM project_labor_expenses WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف السجل بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 9. مستخلصات وشهادات دفع المشروع (Project Invoices & IPCs)
// ============================================================================
router.get('/:projectId/invoices', (req, res) => {
  try {
    const invoices = query(`
      SELECT pi.*, c.name as client_name, c.phone as client_phone
      FROM project_invoices pi
      LEFT JOIN clients c ON pi.client_id = c.id
      WHERE pi.project_id = ?
      ORDER BY pi.date DESC, pi.id DESC
    `, [req.params.projectId]);
    res.json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/invoices', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      client_id, invoice_no, invoice_type = 'مستخلص جاري', period_from, period_to,
      cumulative_work_done = 0, previous_bills_amount = 0, current_gross_amount = 0,
      advance_deduction = 0, retention_deduction = 0, other_deductions = 0,
      net_amount, status = 'معتمد للصرف', date, approval_date, notes
    } = req.body;

    const countRes = get('SELECT COUNT(*) as cnt FROM project_invoices WHERE project_id = ?', [projectId]);
    const autoNo = invoice_no || `IPC-${String((countRes.cnt || 0) + 1).padStart(2, '0')}`;

    const gross = Number(current_gross_amount) || (Number(cumulative_work_done) - Number(previous_bills_amount));
    const deductions = (Number(advance_deduction) || 0) + (Number(retention_deduction) || 0) + (Number(other_deductions) || 0);
    const calculatedNet = net_amount !== undefined ? Number(net_amount) : Math.max(0, gross - deductions);

    const result = run(`
      INSERT INTO project_invoices (
        project_id, client_id, invoice_no, invoice_type, period_from, period_to,
        cumulative_work_done, previous_bills_amount, current_gross_amount,
        advance_deduction, retention_deduction, other_deductions, net_amount,
        status, date, approval_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, client_id ? Number(client_id) : null, autoNo, invoice_type, period_from, period_to,
      Number(cumulative_work_done) || gross, Number(previous_bills_amount) || 0, gross,
      Number(advance_deduction) || 0, Number(retention_deduction) || 0, Number(other_deductions) || 0,
      calculatedNet, status, date || new Date().toISOString().split('T')[0], approval_date, notes
    ]);

    // مزامنة مع جدول bills العام
    run(`
      INSERT INTO bills (bill_no, bill_type, project_id, client_id, amount, deduction, net_amount, status, date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      autoNo, `${invoice_type} (${autoNo})`, projectId, client_id ? Number(client_id) : null,
      gross, deductions, calculatedNet, status, date || new Date().toISOString().split('T')[0], notes
    ]);

    const created = get('SELECT * FROM project_invoices WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم إصدار واعتماد المستخلص بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/invoices/:id', (req, res) => {
  try {
    run('DELETE FROM project_invoices WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المستخلص بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 10. التقارير اليومية للموقع (Daily Site Reports)
// ============================================================================
router.get('/:projectId/daily-reports', (req, res) => {
  try {
    const reports = query('SELECT * FROM project_daily_reports WHERE project_id = ? ORDER BY date DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/daily-reports', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      report_no, date, weather = 'مشمس ومناسب للعمل', manpower_count = 0,
      equipment_summary, work_performed, materials_received, safety_notes,
      delays_obstacles, site_engineer, notes
    } = req.body;

    if (!work_performed) return res.status(400).json({ success: false, message: 'بيان الأعمال المنفذة مطلوب' });

    const countRes = get('SELECT COUNT(*) as cnt FROM project_daily_reports WHERE project_id = ?', [projectId]);
    const autoNo = report_no || `DR-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = run(`
      INSERT INTO project_daily_reports (
        project_id, report_no, date, weather, manpower_count,
        equipment_summary, work_performed, materials_received,
        safety_notes, delays_obstacles, site_engineer, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, date || new Date().toISOString().split('T')[0], weather, Number(manpower_count) || 0,
      equipment_summary, work_performed, materials_received, safety_notes, delays_obstacles, site_engineer, notes
    ]);

    const created = get('SELECT * FROM project_daily_reports WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم توثيق التقرير اليومي للموقع بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/daily-reports/:id', (req, res) => {
  try {
    run('DELETE FROM project_daily_reports WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف التقرير اليومي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 11. التقارير الأسبوعية للموقع (Weekly Site Reports)
// ============================================================================
router.get('/:projectId/weekly-reports', (req, res) => {
  try {
    const reports = query('SELECT * FROM project_weekly_reports WHERE project_id = ? ORDER BY date_to DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/weekly-reports', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      report_no, week_no = 1, date_from, date_to, planned_progress_pct = 0,
      actual_progress_pct = 0, achievements_summary, next_week_plan,
      critical_issues, prepared_by, approved_by, notes
    } = req.body;

    if (!achievements_summary) return res.status(400).json({ success: false, message: 'ملخص إنجازات الأسبوع مطلوب' });

    const countRes = get('SELECT COUNT(*) as cnt FROM project_weekly_reports WHERE project_id = ?', [projectId]);
    const autoNo = report_no || `WR-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = run(`
      INSERT INTO project_weekly_reports (
        project_id, report_no, week_no, date_from, date_to,
        planned_progress_pct, actual_progress_pct, achievements_summary,
        next_week_plan, critical_issues, prepared_by, approved_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, Number(week_no) || 1, date_from || new Date().toISOString().split('T')[0],
      date_to || new Date().toISOString().split('T')[0], Number(planned_progress_pct) || 0,
      Number(actual_progress_pct) || 0, achievements_summary, next_week_plan,
      critical_issues, prepared_by, approved_by, notes
    ]);

    // تحديث نسبة إنجاز المشروع إذا تم إدخالها
    if (actual_progress_pct > 0) {
      run('UPDATE projects SET progress_percentage = ? WHERE id = ?', [Number(actual_progress_pct), projectId]);
    }

    const created = get('SELECT * FROM project_weekly_reports WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم حفظ واعتماد التقرير الأسبوعي بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/weekly-reports/:id', (req, res) => {
  try {
    run('DELETE FROM project_weekly_reports WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف التقرير الأسبوعي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 12. محاضر الاستلام والفحص الهندسي (Handover Minutes)
// ============================================================================
router.get('/:projectId/handovers', (req, res) => {
  try {
    const handovers = query('SELECT * FROM project_handover_minutes WHERE project_id = ? ORDER BY inspection_date DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: handovers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/handovers', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      minute_no, type, location_axis, inspection_date,
      inspector_name, contractor_rep, status = 'معتمد ومقبول',
      punch_list, recommendations, notes
    } = req.body;

    if (!type || !inspector_name) return res.status(400).json({ success: false, message: 'نوع الاستلام واسم المهندس الفاحص مطلوبان' });

    const countRes = get('SELECT COUNT(*) as cnt FROM project_handover_minutes WHERE project_id = ?', [projectId]);
    const autoNo = minute_no || `IR-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = run(`
      INSERT INTO project_handover_minutes (
        project_id, minute_no, type, location_axis, inspection_date,
        inspector_name, contractor_rep, status, punch_list, recommendations, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, type, location_axis, inspection_date || new Date().toISOString().split('T')[0],
      inspector_name, contractor_rep, status, punch_list, recommendations, notes
    ]);

    const created = get('SELECT * FROM project_handover_minutes WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم توثيق محضر الاستلام والفحص الهندسي بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/handovers/:id', (req, res) => {
  try {
    run('DELETE FROM project_handover_minutes WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المحضر بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 13. المراسلات مع المالك والاستشاري (Correspondence)
// ============================================================================
router.get('/:projectId/correspondence', (req, res) => {
  try {
    const corr = query('SELECT * FROM project_correspondence WHERE project_id = ? ORDER BY date DESC, id DESC', [req.params.projectId]);
    res.json({ success: true, data: corr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/correspondence', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      ref_no, direction = 'صادر إلى المالك', subject, date,
      priority = 'عادي', summary_body, required_action, response_status = 'قيد الإجراء',
      sender, recipient, attachment_name, notes
    } = req.body;

    if (!subject || !summary_body) return res.status(400).json({ success: false, message: 'موضوع الخطاب ومحتواه مطلوبان' });

    const countRes = get('SELECT COUNT(*) as cnt FROM project_correspondence WHERE project_id = ?', [projectId]);
    const prefix = direction.includes('صادر') ? 'COR-OUT' : 'COR-IN';
    const autoNo = ref_no || `${prefix}-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(3, '0')}`;

    const result = run(`
      INSERT INTO project_correspondence (
        project_id, ref_no, direction, subject, date,
        priority, summary_body, required_action, response_status,
        sender, recipient, attachment_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId, autoNo, direction, subject, date || new Date().toISOString().split('T')[0],
      priority, summary_body, required_action, response_status,
      sender, recipient, attachment_name, notes
    ]);

    const created = get('SELECT * FROM project_correspondence WHERE id = ?', [result.lastInsertRowid]);
    res.json({ success: true, message: 'تم أرشفة المراسلة والخطاب بنجاح', data: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:projectId/correspondence/:id', (req, res) => {
  try {
    run('DELETE FROM project_correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
    res.json({ success: true, message: 'تم حذف المراسلة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 14. الحساب الختامي وتصفية المشروع (Final Settlement)
// ============================================================================
router.get('/:projectId/settlement', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const settlement = get('SELECT * FROM project_final_settlements WHERE project_id = ?', [projectId]);
    res.json({ success: true, data: settlement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:projectId/settlement', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const {
      settlement_no, date, original_contract_val, approved_change_orders_val,
      revised_contract_val, total_executed_work_val, total_client_payments_received,
      released_retention_val, penalties_deductions_val, final_balance_due,
      due_to = 'لصالح المقاول', status = 'معتمد وموقع', prepared_by, approved_by, notes
    } = req.body;

    const autoNo = settlement_no || `SET-PRJ-${String(projectId).padStart(3, '0')}`;

    const existing = get('SELECT id FROM project_final_settlements WHERE project_id = ?', [projectId]);

    if (existing) {
      run(`
        UPDATE project_final_settlements SET
          settlement_no = ?, date = ?, original_contract_val = ?,
          approved_change_orders_val = ?, revised_contract_val = ?,
          total_executed_work_val = ?, total_client_payments_received = ?,
          released_retention_val = ?, penalties_deductions_val = ?,
          final_balance_due = ?, due_to = ?, status = ?,
          prepared_by = ?, approved_by = ?, notes = ?
        WHERE project_id = ?
      `, [
        autoNo, date || new Date().toISOString().split('T')[0],
        Number(original_contract_val) || 0, Number(approved_change_orders_val) || 0,
        Number(revised_contract_val) || 0, Number(total_executed_work_val) || 0,
        Number(total_client_payments_received) || 0, Number(released_retention_val) || 0,
        Number(penalties_deductions_val) || 0, Number(final_balance_due) || 0,
        due_to, status, prepared_by, approved_by, notes, projectId
      ]);
    } else {
      run(`
        INSERT INTO project_final_settlements (
          project_id, settlement_no, date, original_contract_val,
          approved_change_orders_val, revised_contract_val, total_executed_work_val,
          total_client_payments_received, released_retention_val, penalties_deductions_val,
          final_balance_due, due_to, status, prepared_by, approved_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectId, autoNo, date || new Date().toISOString().split('T')[0],
        Number(original_contract_val) || 0, Number(approved_change_orders_val) || 0,
        Number(revised_contract_val) || 0, Number(total_executed_work_val) || 0,
        Number(total_client_payments_received) || 0, Number(released_retention_val) || 0,
        Number(penalties_deductions_val) || 0, Number(final_balance_due) || 0,
        due_to, status, prepared_by, approved_by, notes
      ]);
    }

    // إذا كانت المخالصة معتمدة ومغلقة، نقوم بتحديث حالة المشروع إلى completed
    if (status === 'مغلق ومصفى' || status === 'معتمد وموقع') {
      run('UPDATE projects SET status = "completed", progress_percentage = 100 WHERE id = ?', [projectId]);
    }

    const saved = get('SELECT * FROM project_final_settlements WHERE project_id = ?', [projectId]);
    res.json({ success: true, message: 'تم حفظ واعتماد الحساب الختامي والمخالصة بنجاح', data: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
