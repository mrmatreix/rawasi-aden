/**
 * خدمة التحكم المتقدم في المشاريع (Advanced Project Control Service)
 * تطبق أفضل الممارسات العالمية لإدارة مشاريع المقاولات وفق:
 * - PMI PMBOK 7th Edition
 * - AACE International (Cost Engineering)
 * - ISO 21502:2020 (Project Management)
 *
 * المحاور الأربعة:
 * 1. نسبة الإنجاز الذكية (Smart % Complete) - محسوبة لا مدخلة
 * 2. إدارة الجدول الزمني المتقدمة (WBS + Critical Path Method)
 * 3. إدارة القيمة المكتسبة EVM (Earned Value Management)
 * 4. إدارة المخاطر والمطالبات (Risk & Claims Register)
 */

'use strict';

const { get, query, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');

// ============================================================================
// الثوابت والتعريفات
// ============================================================================

const COMPLETION_METHODS = {
  WEIGHTED_BOQ:     'weighted_boq',
  APPROVED_INVOICES:'approved_invoices',
  COST_RATIO:       'cost_ratio',
  ENGINEER_CERT:    'engineer_cert',
  WBS_WEIGHTED:     'wbs_weighted',
};

const ACTIVITY_STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  ON_HOLD:     'on_hold',
  CANCELLED:   'cancelled',
};

const RISK_MATRIX = {
  getRating: (probability, impact) => {
    const score = probability * impact;
    if (score >= 15) return { rating: 'critical', label: 'حرج', color: '#dc2626' };
    if (score >= 8)  return { rating: 'high',     label: 'عالٍ',  color: '#ea580c' };
    if (score >= 4)  return { rating: 'medium',   label: 'متوسط', color: '#ca8a04' };
    return                  { rating: 'low',      label: 'منخفض', color: '#16a34a' };
  }
};

// ============================================================================
// 1. نسبة الإنجاز الذكية (Smart Percent Complete Engine)
// ============================================================================

const SmartCompletionEngine = {

  async computeProjectCompletion(projectId) {
    const [boqResult, invoiceResult, costResult, wbsResult, engineerCert] = await Promise.all([
      this._computeFromBOQ(projectId),
      this._computeFromApprovedInvoices(projectId),
      this._computeFromCostRatio(projectId),
      this._computeFromWBS(projectId),
      this._getLatestEngineerCertification(projectId),
    ]);

    const sources = [
      { method: COMPLETION_METHODS.WEIGHTED_BOQ,      pct: boqResult.pct,     weight: 0.35, label: 'BOQ المنفذ',           data: boqResult },
      { method: COMPLETION_METHODS.APPROVED_INVOICES,  pct: invoiceResult.pct, weight: 0.30, label: 'المستخلصات المعتمدة', data: invoiceResult },
      { method: COMPLETION_METHODS.COST_RATIO,         pct: costResult.pct,    weight: 0.15, label: 'نسبة التكلفة',         data: costResult },
      { method: COMPLETION_METHODS.WBS_WEIGHTED,       pct: wbsResult.pct,     weight: 0.20, label: 'أنشطة WBS الموزونة',  data: wbsResult },
    ];

    const validSources = sources.filter(s => s.pct !== null && s.pct >= 0);
    let weightedAvg = null;
    if (validSources.length > 0) {
      const totalWeight = validSources.reduce((sum, s) => sum + s.weight, 0);
      weightedAvg = validSources.reduce((sum, s) => sum + (s.pct * s.weight), 0) / totalWeight;
    }

    let recommendedPct = weightedAvg;
    let primarySource = 'weighted_average';
    if (engineerCert && engineerCert.pct !== null) {
      const certAge = (Date.now() - new Date(engineerCert.certified_at).getTime()) / 86400000;
      if (certAge <= 30) {
        recommendedPct = engineerCert.pct;
        primarySource = 'engineer_certification';
      }
    }

    return {
      recommended_pct: recommendedPct !== null ? Math.round(recommendedPct * 100) / 100 : null,
      primary_source: primarySource,
      engineer_cert: engineerCert,
      breakdown: sources,
      computed_at: new Date().toISOString(),
    };
  },

  async validateManualInput(projectId, manualPct, justification, userId) {
    if (manualPct < 0 || manualPct > 100) {
      throw new Error('نسبة الإنجاز يجب أن تكون بين 0 و100');
    }

    const computed = await this.computeProjectCompletion(projectId);
    if (computed.recommended_pct === null) {
      return { accepted: true, warning: 'لا توجد بيانات كافية للتحقق التلقائي - تم القبول مع التسجيل', computed };
    }

    const deviation = Math.abs(manualPct - computed.recommended_pct);
    const MAX_ALLOWED_DEVIATION = 15;

    if (deviation > MAX_ALLOWED_DEVIATION) {
      if (!justification || justification.trim().length < 20) {
        throw new Error(
          `\u26d4 الانحراف المرفوض: النسبة المُدخلة (${manualPct}%) تنحرف ${deviation.toFixed(1)}% عن النسبة المحسوبة (${computed.recommended_pct}%). ` +
          `يجب تقديم مبرر تفصيلي (20 حرف على الأقل) لقبول هذا الانحراف الكبير.`
        );
      }
      await logAudit(null, {
        action: 'MANUAL_COMPLETION_OVERRIDE',
        entity_type: 'projects', entity_id: projectId,
        details: JSON.stringify({ computed_pct: computed.recommended_pct, manual_pct: manualPct, deviation, justification }),
      });
      return { accepted: true, warning: `تم القبول مع التوثيق: انحراف ${deviation.toFixed(1)}%`, computed };
    }

    return { accepted: true, computed };
  },

  async _computeFromBOQ(projectId) {
    try {
      const items = await query(
        `SELECT contract_qty, executed_qty, unit_rate,
                COALESCE(executed_qty, 0) as exec_qty
         FROM project_boq WHERE project_id = ? AND contract_qty > 0`,
        [projectId]
      );
      if (!items.length) return { pct: null, total_boq_value: 0, total_executed_value: 0 };

      let totalBOQ = 0, totalExecuted = 0;
      for (const item of items) {
        const unitPrice = Number(item.unit_rate) || 0;
        totalBOQ      += (Number(item.contract_qty)  || 0) * unitPrice;
        totalExecuted += (Number(item.exec_qty)       || 0) * unitPrice;
      }
      const pct = totalBOQ > 0 ? Math.min((totalExecuted / totalBOQ) * 100, 100) : null;
      return { pct, total_boq_value: totalBOQ, total_executed_value: totalExecuted };
    } catch { return { pct: null, error: true }; }
  },

  async _computeFromApprovedInvoices(projectId) {
    try {
      const contract = await get('SELECT contract_value FROM project_contracts WHERE project_id = ?', [projectId]);
      const contractValue = Number(contract?.contract_value) || 0;
      if (!contractValue) return { pct: null, contract_value: 0 };

      const invoices = await query(
        `SELECT SUM(COALESCE(net_amount, current_gross_amount, 0)) as total
         FROM project_invoices WHERE project_id = ? AND status IN ('معتمد','مرحل','مدفوع')`,
        [projectId]
      );
      const totalApproved = Number(invoices[0]?.total) || 0;
      const pct = Math.min((totalApproved / contractValue) * 100, 100);
      return { pct, contract_value: contractValue, approved_invoices: totalApproved };
    } catch { return { pct: null, error: true }; }
  },

  async _computeFromCostRatio(projectId) {
    try {
      const budget = await get(
        'SELECT SUM(COALESCE(planned_cost,0)) as total FROM project_budgets WHERE project_id = ?',
        [projectId]
      );
      const totalBudget = Number(budget?.total) || 0;
      if (!totalBudget) return { pct: null, total_budget: 0 };

      const [purchases, labor] = await Promise.all([
        query('SELECT SUM(COALESCE(total_amount,0)) as total FROM project_purchases WHERE project_id = ?', [projectId]),
        query('SELECT SUM(COALESCE(total_amount,0)) as total FROM project_labor_expenses WHERE project_id = ?', [projectId]),
      ]);
      const actualCost = (Number(purchases[0]?.total) || 0) + (Number(labor[0]?.total) || 0);
      const pct = Math.min((actualCost / totalBudget) * 100, 100);
      return { pct, total_budget: totalBudget, actual_cost: actualCost };
    } catch { return { pct: null, error: true }; }
  },

  async _computeFromWBS(projectId) {
    try {
      const activities = await query(
        `SELECT status, weight FROM project_wbs_activities WHERE project_id = ? AND weight > 0`,
        [projectId]
      );
      if (!activities.length) return { pct: null, activities_count: 0 };

      const totalWeight = activities.reduce((sum, a) => sum + (Number(a.weight) || 0), 0);
      let completedWeight = 0;
      for (const act of activities) {
        const w = Number(act.weight) || 0;
        if (act.status === ACTIVITY_STATUS.COMPLETED) completedWeight += w;
        else if (act.status === ACTIVITY_STATUS.IN_PROGRESS) completedWeight += w * 0.5;
      }
      const pct = totalWeight > 0 ? Math.min((completedWeight / totalWeight) * 100, 100) : null;
      return { pct, total_activities: activities.length, completed_weight: completedWeight, total_weight: totalWeight };
    } catch { return { pct: null, error: true }; }
  },

  async _getLatestEngineerCertification(projectId) {
    try {
      return await get(
        `SELECT pct, certified_by, certified_at, notes
         FROM project_engineer_certifications WHERE project_id = ?
         ORDER BY certified_at DESC LIMIT 1`,
        [projectId]
      );
    } catch { return null; }
  },
};

// ============================================================================
// 2. إدارة WBS والجدول الزمني (WBS + Critical Path Method)
// ============================================================================

const WBSScheduler = {

  async computeCriticalPath(projectId) {
    const activities = await query(
      `SELECT a.*, GROUP_CONCAT(d.predecessor_id) as predecessor_ids
       FROM project_wbs_activities a
       LEFT JOIN project_wbs_dependencies d ON d.successor_id = a.id
       WHERE a.project_id = ?
       GROUP BY a.id
       ORDER BY a.wbs_code`,
      [projectId]
    );

    if (!activities.length) return { activities: [], critical_path: [], project_duration: 0 };

    const actMap = {};
    for (const act of activities) {
      actMap[act.id] = {
        ...act,
        predecessors: act.predecessor_ids ? act.predecessor_ids.split(',').map(Number).filter(Boolean) : [],
        duration: Number(act.planned_duration_days) || 0,
        ES: 0, EF: 0, LS: 0, LF: 0, TF: 0, FF: 0, is_critical: false,
      };
    }

    const sorted = this._topologicalSort(actMap);

    // Forward Pass
    for (const id of sorted) {
      const act = actMap[id];
      if (act.predecessors.length === 0) {
        act.ES = 0;
      } else {
        act.ES = Math.max(...act.predecessors.map(predId => actMap[predId]?.EF || 0));
      }
      act.EF = act.ES + act.duration;
    }

    const projectDuration = Math.max(...Object.values(actMap).map(a => a.EF));

    // Backward Pass
    for (const id of [...sorted].reverse()) {
      const act = actMap[id];
      const successors = Object.values(actMap).filter(s => s.predecessors.includes(id));
      if (successors.length === 0) {
        act.LF = projectDuration;
      } else {
        act.LF = Math.min(...successors.map(s => s.LS));
      }
      act.LS = act.LF - act.duration;
      act.TF = act.LS - act.ES;
    }

    // Free Float + Critical Path
    for (const id of sorted) {
      const act = actMap[id];
      const successors = Object.values(actMap).filter(s => s.predecessors.includes(id));
      act.FF = successors.length > 0
        ? Math.min(...successors.map(s => s.ES)) - act.EF
        : act.LF - act.EF;
      act.is_critical = act.TF <= 0;
    }

    const criticalPath = sorted.filter(id => actMap[id].is_critical);
    const activitiesResult = sorted.map(id => actMap[id]);

    for (const act of activitiesResult) {
      await run(
        `UPDATE project_wbs_activities SET
           es_days=?, ef_days=?, ls_days=?, lf_days=?,
           total_float_days=?, free_float_days=?, is_critical=?
         WHERE id=?`,
        [act.ES, act.EF, act.LS, act.LF, act.TF, act.FF, act.is_critical ? 1 : 0, act.id]
      );
    }

    return {
      activities: activitiesResult,
      critical_path: criticalPath,
      project_duration: projectDuration,
      computed_at: new Date().toISOString(),
    };
  },

  async compareBaselineVsActual(projectId) {
    const activities = await query(
      `SELECT a.*,
              b.planned_start as baseline_start, b.planned_finish as baseline_finish,
              b.planned_duration_days as baseline_duration
       FROM project_wbs_activities a
       LEFT JOIN project_wbs_baselines b ON b.activity_id = a.id AND b.is_current = 1
       WHERE a.project_id = ?
       ORDER BY a.wbs_code`,
      [projectId]
    );

    const today = new Date();
    const variances = activities.map(act => {
      const plannedStart  = act.baseline_start  ? new Date(act.baseline_start)  : null;
      const plannedFinish = act.baseline_finish ? new Date(act.baseline_finish) : null;
      const actualStart   = act.actual_start    ? new Date(act.actual_start)    : null;
      const actualFinish  = act.actual_finish   ? new Date(act.actual_finish)   : null;

      let startVariance = null, finishVariance = null, isDelayed = false;
      if (plannedStart && actualStart) startVariance = Math.round((actualStart - plannedStart) / 86400000);
      if (plannedFinish) {
        if (actualFinish) {
          finishVariance = Math.round((actualFinish - plannedFinish) / 86400000);
          isDelayed = finishVariance > 0;
        } else if (act.status !== ACTIVITY_STATUS.COMPLETED && today > plannedFinish) {
          finishVariance = Math.round((today - plannedFinish) / 86400000);
          isDelayed = true;
        }
      }

      return {
        ...act, start_variance_days: startVariance, finish_variance_days: finishVariance, is_delayed: isDelayed,
        delay_severity: isDelayed ? (finishVariance > 30 ? 'critical' : finishVariance > 7 ? 'high' : 'low') : null,
      };
    });

    const delayed = variances.filter(a => a.is_delayed);
    return {
      activities: variances,
      summary: {
        total: activities.length,
        delayed: delayed.length,
        on_time: variances.filter(a => !a.is_delayed && a.status !== ACTIVITY_STATUS.NOT_STARTED).length,
        critical_delays: delayed.filter(a => a.delay_severity === 'critical').length,
        avg_delay_days: delayed.length
          ? delayed.reduce((s, a) => s + (a.finish_variance_days || 0), 0) / delayed.length : 0,
      },
    };
  },

  async saveBaseline(projectId, label, userId) {
    await run('UPDATE project_wbs_baselines SET is_current = 0 WHERE project_id = ?', [projectId]);
    const activities = await query(
      'SELECT id, planned_start, planned_finish, planned_duration_days FROM project_wbs_activities WHERE project_id = ?',
      [projectId]
    );

    await transaction(async (trx) => {
      for (const act of activities) {
        await trx.run(
          `INSERT INTO project_wbs_baselines
             (project_id, activity_id, label, planned_start, planned_finish,
              planned_duration_days, is_current, created_by, created_at)
           VALUES (?,?,?,?,?,?,1,?,datetime('now'))`,
          [projectId, act.id, label, act.planned_start, act.planned_finish, act.planned_duration_days, userId]
        );
      }
    });

    await logAudit(null, {
      action: 'BASELINE_SAVED', entity_type: 'project_wbs_baselines', entity_id: projectId,
      details: JSON.stringify({ label, activities_count: activities.length }),
    });
    return { success: true, activities_count: activities.length };
  },

  _topologicalSort(actMap) {
    const visited = new Set(), result = [];
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const predId of (actMap[id]?.predecessors || [])) {
        if (actMap[predId]) visit(predId);
      }
      result.push(id);
    };
    Object.keys(actMap).forEach(id => visit(Number(id)));
    return result;
  },
};

// ============================================================================
// 3. إدارة القيمة المكتسبة EVM
// ============================================================================

const EVMEngine = {

  async computeEVM(projectId, statusDate = null) {
    const asOf = statusDate ? new Date(statusDate) : new Date();
    const asOfStr = asOf.toISOString().split('T')[0];

    const [contract, budget, activities, invoiceRows, costRows] = await Promise.all([
      get('SELECT * FROM project_contracts WHERE project_id = ?', [projectId]),
      query('SELECT SUM(COALESCE(planned_cost,0)) as total FROM project_budgets WHERE project_id = ?', [projectId]),
      query('SELECT * FROM project_wbs_activities WHERE project_id = ?', [projectId]),
      query(
        `SELECT SUM(COALESCE(net_amount, current_gross_amount, 0)) as total
         FROM project_invoices WHERE project_id = ? AND status IN ('معتمد','مرحل','مدفوع') AND date <= ?`,
        [projectId, asOfStr]
      ),
      query(
        `SELECT
           (SELECT COALESCE(SUM(total_amount),0) FROM project_purchases WHERE project_id=? AND date<=?) +
           (SELECT COALESCE(SUM(total_amount),0) FROM project_labor_expenses WHERE project_id=? AND date<=?) as total`,
        [projectId, asOfStr, projectId, asOfStr]
      ),
    ]);

    const BAC = Number(budget[0]?.total) || Number(contract?.contract_value) || 0;
    if (!BAC) return { error: 'الميزانية الإجمالية (BAC) غير محددة' };

    const wbsResult = await SmartCompletionEngine.computeProjectCompletion(projectId);
    const completionPct = (wbsResult.recommended_pct || 0) / 100;

    const PV = this._computePlannedValue(activities, asOf, BAC);
    const EV = BAC * completionPct;
    const AC = Number(costRows[0]?.total) || 0;

    const CV  = EV - AC;
    const SV  = EV - PV;
    const CPI = AC > 0 ? EV / AC : null;
    const SPI = PV > 0 ? EV / PV : null;
    const TCPI_BAC = (BAC - EV) > 0 && (BAC - AC) > 0 ? (BAC - EV) / (BAC - AC) : null;
    const EAC_typical  = CPI ? BAC / CPI : null;
    const EAC_atypical = AC + (BAC - EV);
    const EAC_combined = CPI && SPI ? AC + (BAC - EV) / (CPI * SPI) : null;
    const EAC = EAC_typical;
    const ETC = EAC !== null ? EAC - AC : null;
    const VAC = EAC !== null ? BAC - EAC : null;

    const tl = (val, isIndex = true) => {
      if (val === null) return 'grey';
      if (isIndex) return val >= 1.0 ? 'green' : val >= 0.9 ? 'yellow' : 'red';
      return val >= 0 ? 'green' : val >= -0.05 * BAC ? 'yellow' : 'red';
    };

    const r = (v) => v !== null ? Math.round(v * 100) / 100 : null;
    const ri = (v) => v !== null ? Math.round(v * 1000) / 1000 : null;

    const result = {
      status_date: asOfStr,
      bac: r(BAC), pv: r(PV), ev: r(EV), ac: r(AC),
      cv: r(CV), sv: r(SV),
      cpi: ri(CPI), spi: ri(SPI), tcpi_bac: ri(TCPI_BAC),
      eac: r(EAC), etc: r(ETC), vac: r(VAC),
      eac_scenarios: { typical: r(EAC_typical), atypical: r(EAC_atypical), combined: r(EAC_combined) },
      completion_pct: wbsResult.recommended_pct,
      status_lights: { cost: tl(CPI, true), schedule: tl(SPI, true), cv: tl(CV, false), sv: tl(SV, false), vac: tl(VAC, false) },
      interpretation: this._interpretEVM(CPI, SPI, CV, SV, BAC),
    };

    // حفظ لقطة تاريخية
    try {
      await run(
        `INSERT OR REPLACE INTO project_evm_snapshots
           (project_id, status_date, bac, pv, ev, ac, cv, sv, cpi, spi, eac, etc, vac, completion_pct, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        [projectId, asOfStr, result.bac, result.pv, result.ev, result.ac,
         result.cv, result.sv, result.cpi, result.spi,
         result.eac, result.etc, result.vac, result.completion_pct]
      );
    } catch (_) { /* جدول قد لا يكون موجوداً بعد */ }

    return result;
  },

  _computePlannedValue(activities, asOf, BAC) {
    if (!activities.length) return 0;
    const totalWeight = activities.reduce((s, a) => s + (Number(a.weight) || 0), 0);
    if (!totalWeight) return 0;

    let plannedPct = 0;
    const asOfMs = asOf.getTime();
    for (const act of activities) {
      const start  = act.planned_start  ? new Date(act.planned_start).getTime()  : null;
      const finish = act.planned_finish ? new Date(act.planned_finish).getTime() : null;
      const weight = (Number(act.weight) || 0) / totalWeight;
      if (!start || !finish || finish <= start) continue;
      if (asOfMs >= finish) plannedPct += weight;
      else if (asOfMs > start) plannedPct += weight * ((asOfMs - start) / (finish - start));
    }
    return BAC * plannedPct;
  },

  _interpretEVM(CPI, SPI, CV, SV, BAC) {
    const lines = [];
    if (CPI === null || SPI === null) return ['بيانات غير كافية لتفسير EVM'];
    if (CPI >= 1.0 && SPI >= 1.0) lines.push('المشروع في وضع ممتاز: أمام الجدول وضمن الميزانية');
    else if (CPI >= 1.0 && SPI < 1.0) lines.push('التكلفة جيدة لكن المشروع متأخر عن الجدول الزمني');
    else if (CPI < 1.0 && SPI >= 1.0) lines.push('الجدول جيد لكن التكاليف تتجاوز الميزانية');
    else lines.push('وضع حرج: المشروع متأخر وتكاليفه تتجاوز الميزانية - يستوجب اجتماع إدارة فوري');
    if (CPI < 0.85) lines.push(`كل ريال يصرف ينتج ${(CPI * 100).toFixed(0)} هللة فقط`);
    if (SPI < 0.85) lines.push(`كفاءة الجدول ${(SPI * 100).toFixed(0)}% - تأخر ملحوظ`);
    return lines;
  },
};

// ============================================================================
// 4. إدارة المخاطر والمطالبات
// ============================================================================

const RiskClaimsEngine = {

  async addRisk(projectId, riskData, userId) {
    const { title, description, category, probability, impact,
            financial_impact, schedule_impact_days, owner_id,
            treatment_type, treatment_plan, review_date } = riskData;

    if (!title || probability === undefined || probability === null || impact === undefined || impact === null) {
      throw new Error('العنوان والاحتمالية والتأثير حقول إلزامية');
    }
    const prob = Number(probability), imp = Number(impact);
    if (isNaN(prob) || isNaN(imp)) throw new Error('العنوان والاحتمالية والتأثير حقول إلزامية');
    if (prob < 1 || prob > 5 || imp < 1 || imp > 5)
      throw new Error('الاحتمالية والتأثير يجب أن يكونا بين 1 و5');

    const rating = RISK_MATRIX.getRating(probability, impact);
    const riskScore = probability * impact;

    const result = await run(
      `INSERT INTO project_risk_register
         (project_id, title, description, category, probability, impact,
          risk_score, risk_rating, financial_impact, schedule_impact_days,
          owner_id, treatment_type, treatment_plan, status, review_date,
          created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,datetime('now'),datetime('now'))`,
      [projectId, title, description, category || 'general',
       probability, impact, riskScore, rating.rating,
       financial_impact || 0, schedule_impact_days || 0,
       owner_id || null, treatment_type || 'mitigate', treatment_plan || null,
       review_date || null, userId]
    );

    await logAudit(null, {
      action: 'RISK_ADDED', entity_type: 'project_risk_register', entity_id: result.lastInsertRowid || result.insertId,
      details: JSON.stringify({ title, risk_score: riskScore, rating: rating.label }),
    });
    return { id: result.lastInsertRowid || result.insertId, risk_score: riskScore, rating };
  },

  async addClaim(projectId, claimData, userId) {
    const { claim_type, title, description, claimed_amount, claimed_days,
            submitted_date, responsible_party, supporting_docs, priority } = claimData;

    const VALID_TYPES = ['تمديد_وقت', 'تكلفة_إضافية', 'تعويض_تأخير', 'تسوية_خلاف', 'طلب_معلومات_RFI'];
    if (!VALID_TYPES.includes(claim_type))
      throw new Error(`نوع المطالبة غير صالح. المتاح: ${VALID_TYPES.join(', ')}`);

    const result = await run(
      `INSERT INTO project_claims_register
         (project_id, claim_type, title, description, claimed_amount, claimed_days,
          submitted_date, responsible_party, supporting_docs, priority,
          status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'مفتوح',?,datetime('now'),datetime('now'))`,
      [projectId, claim_type, title, description,
       claimed_amount || 0, claimed_days || 0,
       submitted_date || new Date().toISOString().split('T')[0],
       responsible_party, supporting_docs || null, priority || 'medium', userId]
    );

    await logAudit(null, {
      action: 'CLAIM_FILED', entity_type: 'project_claims_register', entity_id: result.lastInsertRowid || result.insertId,
      details: JSON.stringify({ claim_type, title, claimed_amount }),
    });
    return { id: result.lastInsertRowid || result.insertId };
  },

  async addNCR(projectId, ncrData, userId) {
    const { title, description, location, responsible_party, severity, root_cause, corrective_action, due_date } = ncrData;
    if (!title || !description) throw new Error('العنوان والوصف حقول إلزامية لتقرير عدم المطابقة');

    const result = await run(
      `INSERT INTO project_non_conformance
         (project_id, title, description, location, responsible_party, severity,
          root_cause, corrective_action, due_date, status, reported_by, reported_date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'مفتوح',?,date('now'),datetime('now'))`,
      [projectId, title, description, location, responsible_party,
       severity || 'medium', root_cause, corrective_action, due_date, userId]
    );

    await logAudit(null, {
      action: 'NCR_RAISED', entity_type: 'project_non_conformance', entity_id: result.lastInsertRowid || result.insertId,
      details: JSON.stringify({ title, severity }),
    });
    return { id: result.lastInsertRowid || result.insertId };
  },

  async addRFI(projectId, rfiData, userId) {
    const { subject, description, submitted_to, required_response_date, discipline, priority } = rfiData;
    if (!subject) throw new Error('موضوع طلب المعلومات (RFI) إلزامي');

    const result = await run(
      `INSERT INTO project_rfi
         (project_id, subject, description, submitted_to, required_response_date,
          discipline, priority, status, submitted_by, submitted_date, created_at)
       VALUES (?,?,?,?,?,?,?,'معلق',?,date('now'),datetime('now'))`,
      [projectId, subject, description, submitted_to, required_response_date,
       discipline, priority || 'normal', userId]
    );

    await logAudit(null, {
      action: 'RFI_SUBMITTED', entity_type: 'project_rfi', entity_id: result.lastInsertRowid || result.insertId,
      details: JSON.stringify({ subject, submitted_to }),
    });
    return { id: result.lastInsertRowid || result.insertId };
  },

  async getRiskDashboard(projectId) {
    const [risks, claims, ncrs, rfis] = await Promise.all([
      query(
        `SELECT r.*, u.full_name as owner_name FROM project_risk_register r
         LEFT JOIN users u ON u.id = r.owner_id WHERE r.project_id = ? ORDER BY r.risk_score DESC`,
        [projectId]
      ),
      query('SELECT * FROM project_claims_register WHERE project_id = ? ORDER BY created_at DESC', [projectId]),
      query('SELECT * FROM project_non_conformance WHERE project_id = ? ORDER BY reported_date DESC', [projectId]),
      query('SELECT * FROM project_rfi WHERE project_id = ? ORDER BY submitted_date DESC', [projectId]),
    ]);

    const enrichedRisks = risks.map(r => ({
      ...r,
      rating_details: RISK_MATRIX.getRating(r.probability, r.impact),
      is_overdue_review: r.review_date && new Date(r.review_date) < new Date() && r.status === 'open',
    }));

    return {
      risks: enrichedRisks, claims, non_conformances: ncrs, rfis,
      summary: {
        risk_summary: {
          total: risks.length,
          critical: risks.filter(r => r.risk_rating === 'critical').length,
          high:     risks.filter(r => r.risk_rating === 'high').length,
          medium:   risks.filter(r => r.risk_rating === 'medium').length,
          low:      risks.filter(r => r.risk_rating === 'low').length,
          open:     risks.filter(r => r.status === 'open').length,
          total_financial_exposure: risks.filter(r => r.status === 'open')
                                         .reduce((s, r) => s + (Number(r.financial_impact) || 0), 0),
        },
        claims_summary: {
          total: claims.length, open: claims.filter(c => c.status === 'مفتوح').length,
          total_claimed: claims.reduce((s, c) => s + (Number(c.claimed_amount) || 0), 0),
        },
        ncr_summary: { total: ncrs.length, open: ncrs.filter(n => n.status === 'مفتوح').length },
        rfi_summary: {
          total: rfis.length, pending: rfis.filter(r => r.status === 'معلق').length,
          overdue: rfis.filter(r => r.required_response_date &&
            new Date(r.required_response_date) < new Date() && r.status === 'معلق').length,
        },
      },
    };
  },
};

// ============================================================================
// الصادرات الرئيسية
// ============================================================================

module.exports = {
  COMPLETION_METHODS, ACTIVITY_STATUS, RISK_MATRIX,

  // 1. نسبة الإنجاز الذكية
  computeProjectCompletion: (projectId) => SmartCompletionEngine.computeProjectCompletion(projectId),
  validateManualCompletion: (projectId, pct, justification, userId) =>
    SmartCompletionEngine.validateManualInput(projectId, pct, justification, userId),

  // 2. WBS والجدول الزمني
  computeCriticalPath:     (projectId)          => WBSScheduler.computeCriticalPath(projectId),
  compareBaselineVsActual: (projectId)          => WBSScheduler.compareBaselineVsActual(projectId),
  saveBaseline:            (projectId, lbl, uid) => WBSScheduler.saveBaseline(projectId, lbl, uid),

  // 3. EVM
  computeEVM: (projectId, statusDate) => EVMEngine.computeEVM(projectId, statusDate),

  // 4. المخاطر والمطالبات
  addRisk:         (projectId, data, uid) => RiskClaimsEngine.addRisk(projectId, data, uid),
  addClaim:        (projectId, data, uid) => RiskClaimsEngine.addClaim(projectId, data, uid),
  addNCR:          (projectId, data, uid) => RiskClaimsEngine.addNCR(projectId, data, uid),
  addRFI:          (projectId, data, uid) => RiskClaimsEngine.addRFI(projectId, data, uid),
  getRiskDashboard:(projectId)            => RiskClaimsEngine.getRiskDashboard(projectId),
};
