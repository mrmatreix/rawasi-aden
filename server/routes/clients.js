const {nextPartyNumber,validateStatus} = require('../services/partyRegistryService');
const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { requirePermission } = require('../middleware/security');
const clientChainService = require('../services/clientChainService');

// جلب جميع العملاء مع الأرصدة اللحظية والسلسلة المالية المجمعة (Zero N+1 View)
router.get('/', requirePermission('clients:view'), async (req, res) => {
  try {
    let clients = [];
    try {
      clients = await query('SELECT * FROM view_client_financial_profiles ORDER BY id ASC');
    } catch (e) {
      clients = await query(`SELECT c.*, a.code AS account_code, a.name AS account_name
        FROM clients c LEFT JOIN accounts a ON a.id = c.account_id ORDER BY c.id ASC`);
    }
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العملاء', error: err.message });
  }
});

// جلب عميل بالمعرف مع مؤشراته المالية
router.get('/:id', requirePermission('clients:view'), async (req, res) => {
  try {
    let client = null;
    try {
      client = await get('SELECT profile.*, c.notes FROM view_client_financial_profiles profile JOIN clients c ON c.id = profile.id WHERE profile.id = ?', [req.params.id]);
    } catch (e) {}
    if (!client) {
      client = await get(`SELECT c.*, a.code AS account_code, a.name AS account_name
        FROM clients c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ?`, [req.params.id]);
    }
    if (!client) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العميل', error: err.message });
  }
});

// السلسلة الهرمية الكاملة للعميل:
// عميل → عقد → مشاريع → مستخلصات → مطالبات → دفعات مقدمة → مبالغ محصلة → محتجزات → رصيد مستحق
router.get('/:id/chain', requirePermission('clients:view,reports:view,accounting:view'), async (req, res) => {
  try {
    const chainData = await clientChainService.getClientLifecycleChain(req.params.id);
    res.json({ success: true, data: chainData });
  } catch (err) {
    const status = err.message.includes('غير موجود') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// إعادة المزامنة الذرية لرصيد العميل والتأكد من مطابقة دفتر الأستاذ والمستخلصات
router.post('/:id/sync-balance', requirePermission('clients:edit,accounting:edit'), async (req, res) => {
  try {
    const syncRes = await clientChainService.syncClientBalances(req.params.id);
    if (!syncRes) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    res.json({ success: true, message: 'تمت مزامنة رصيد ومستحقات العميل بنجاح', data: syncRes });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء مزامنة رصيد العميل: ' + err.message });
  }
});

// جلب عقود العميل
router.get('/:id/contracts', requirePermission('clients:view,projects:view'), async (req, res) => {
  try {
    const contracts = await query(`
      SELECT pc.*, p.name AS project_name
      FROM project_contracts pc
      LEFT JOIN projects p ON pc.project_id = p.id
      WHERE pc.client_id = ? OR p.client_id = ?
      ORDER BY pc.contract_date DESC
    `, [req.params.id, req.params.id]);
    res.json({ success: true, data: contracts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// جلب مستخلصات العميل
router.get('/:id/bills', requirePermission('clients:view,billing:view'), async (req, res) => {
  try {
    const bills = await query(`
      SELECT b.*, p.name AS project_name, pc.contract_no
      FROM bills b
      LEFT JOIN projects p ON b.project_id = p.id
      LEFT JOIN project_contracts pc ON b.contract_id = pc.id
      WHERE b.client_id = ? AND b.status NOT IN ('reversed', 'cancelled')
      ORDER BY b.date DESC
    `, [req.params.id]);
    res.json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إضافة عميل جديد مع التأكيد والتحقق من قاعدة البيانات
router.post('/', requirePermission('clients:create'), async (req, res) => {
  try {
    const { name, company, phone, email, address, previous_balance = 0, currency = 'ر.ي', notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    }

    const trimmedName = name.trim();
    const prevBal = Number(previous_balance) || 0;
    const selectedCurrency = currency || 'ر.ي';

    const ledgerAccount = await get("SELECT id, code, name FROM accounts WHERE code = '12301001'");
    if (!ledgerAccount) {
      return res.status(409).json({ success: false, message: 'تعذر إضافة العميل: الحساب 12301001 غير موجود في دليل الحسابات' });
    }

    const result = await transaction(async tx => {
      const partyNo=await nextPartyNumber(tx,'client');
      return tx.run(`
      INSERT INTO clients (party_no, account_id, name, company, phone, email, address, previous_balance, current_balance, currency, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      partyNo, ledgerAccount.id,
      trimmedName,
      company ? company.trim() : '',
      phone ? phone.trim() : '',
      email ? email.trim() : '',
      address ? address.trim() : '',
      prevBal,
      prevBal,
      selectedCurrency,
      notes ? notes.trim() : ''
    ]);

    });

    const newId = result.lastInsertRowid || result.insertId;

    const confirmedClient = await get(`SELECT c.*, a.code AS account_code, a.name AS account_name
      FROM clients c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ?`, [newId]);

    res.json({
      success: true,
      message: `تم حفظ العميل (${confirmedClient ? confirmedClient.name : trimmedName}) وربطه بالحساب ${ledgerAccount.code} بنجاح`,
      data: confirmedClient,
      id: newId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حفظ العميل: ' + err.message, error: err.message });
  }
});


router.put('/:id',requirePermission('clients:edit'),async(req,res)=>{
 try {
  const old=await get('SELECT * FROM clients WHERE id=?',[req.params.id]);
  if(!old)return res.status(404).json({success:false,message:'العميل غير موجود'});
  const name=String(req.body.name ?? old.name).trim();
  if(!name)return res.status(400).json({success:false,message:'اسم العميل مطلوب'});
  const status=validateStatus(req.body.status ?? old.status ?? 'active');
  const fields=['company','phone','email','address','currency','notes'];
  const values=fields.map(key=>String(req.body[key] ?? old[key] ?? '').trim());
  await run('UPDATE clients SET name=?,company=?,phone=?,email=?,address=?,currency=?,notes=?,status=? WHERE id=?',[name,...values,status,old.id]);
  await require('../services/auditService').logAudit(req,{action:'UPDATE',entity_type:'client',entity_id:String(old.id),old_values:{name:old.name,status:old.status},new_values:{name,status}});
  res.json({success:true,message:'تم تعديل العميل بنجاح',id:old.id,data:await get('SELECT * FROM clients WHERE id=?',[old.id])});
 }catch(error){res.status(error.statusCode||500).json({success:false,message:error.message});}
});

module.exports = router;
