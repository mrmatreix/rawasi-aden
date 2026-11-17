/** Convert an accepted request as one unit using the current ERP database. */
async function convertServiceRequest(db, requestId, actorId) {
  return db.transaction(async (tx) => {
    // Claim the request first: concurrent conversions cannot create two projects.
    const claimed = await tx.run("UPDATE service_requests SET status='converted', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='client_accepted'", [requestId]);
    if (!claimed.changes) {
      const exists = await tx.get('SELECT id FROM service_requests WHERE id=?', [requestId]);
      throw Object.assign(new Error(exists ? 'يلزم موافقة العميل على العرض، ولم يسبق تحويل الطلب' : 'الطلب غير موجود'), { statusCode: exists ? 409 : 404 });
    }
    const request = await tx.get('SELECT * FROM service_requests WHERE id=?', [requestId]);
    const quote = await tx.get("SELECT * FROM service_request_quotes WHERE request_id=? AND state='accepted' ORDER BY version DESC LIMIT 1", [requestId]);
    if (!quote) throw Object.assign(new Error('لا يوجد عرض سعر مقبول لهذا الطلب'), { statusCode: 409 });

    let clientId = null;
    if (request.client_user_id) clientId = (await tx.get('SELECT client_id FROM client_users WHERE id=?', [request.client_user_id]))?.client_id;
    if (!clientId) {
      const client = await tx.get('SELECT id FROM clients WHERE phone=? AND phone IS NOT NULL AND phone<>\'\' LIMIT 1', [request.phone]);
      clientId = client?.id;
    }
    if (!clientId) {
      const account = await tx.get("SELECT id FROM accounts WHERE code='12301001'");
      if (!account) throw Object.assign(new Error('تعذر إنشاء العميل: الحساب 12301001 غير موجود في دليل الحسابات'), { statusCode: 409 });
      const client = await tx.run('INSERT INTO clients (account_id,name,phone,email,notes,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)', [account.id, request.client_name, request.phone, request.email, `تم الإنشاء من طلب الخدمة ${request.request_no}`]);
      clientId = client.lastInsertRowid;
    }

    const name = request.project_name || `مشروع ${request.client_name} - ${request.project_type || 'أعمال هندسية'}`;
    const code = `PRJ-SR-${requestId}`;
    const notes = request.description || `مشروع محول من طلب الخدمة: ${request.request_no}`;
    const project = await tx.run("INSERT INTO projects (code,name,client_id,status,contract_value,location,description,notes,created_at) VALUES (?,?,?,'active',?,?,?,?,CURRENT_TIMESTAMP)", [code, name, clientId, quote.amount, request.location || 'عدن', notes, notes]);
    const projectId = project.lastInsertRowid;
    const centerCode = `CC-SR-${requestId}`;
    const center = await tx.run("INSERT INTO cost_centers (code,name,type,project_id,status,notes) VALUES (?,?,'مشروع',?,'active',?)", [centerCode, name, projectId, `مركز تكلفة طلب الخدمة ${request.request_no}`]);
    await tx.run('INSERT INTO service_request_events (request_id,actor_type,actor_id,event_type,message) VALUES (?,?,?,?,?)', [requestId, 'staff', actorId, 'project_converted', `تم تحويل الطلب إلى المشروع ${code}`]);
    return { projectId, projectCode: code, costCenterId: center.lastInsertRowid, requestNo: request.request_no, projectName: name };
  });
}
module.exports = { convertServiceRequest };
