const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config/environment');
config.validateProduction();
const database = require('./database/db');
const { securityHeaders, corsOptions, originGuard, createRateLimiter } = require('./middleware/httpSecurity');
const { publicFiles } = require('./middleware/fileAccess');

// إعداد تطبيق Express
const app = express();
const PORT = config.port;

// البرمجيات الوسيطة (Middleware)
app.disable('x-powered-by');
app.set('trust proxy', config.isProd ? 1 : false);
app.use(securityHeaders);
app.use(cors(corsOptions()));
app.use('/api', originGuard);
app.use('/api/auth', createRateLimiter({max:40,windowMs:60000}));
app.use('/api/client-portal/auth', createRateLimiter({max:40,windowMs:60000}));
const serviceSubmissions = createRateLimiter({max:12,windowMs:15*60*1000});
app.use('/api/client-portal/services/requests', (req,res,next)=>req.method==='POST'?serviceSubmissions(req,res,next):next());
// أرشفة الماسح الضوئي ترسل PDF/صورة بصيغة Base64 (حتى 25MB)،
// لذلك نحتاج هامشاً فوق الحجم الأصلي بسبب زيادة Base64 بنحو الثلث.
app.use(express.json({ limit: '40mb' }));
app.use(express.text({ type: ['text/plain', 'application/json'], limit: '40mb' }));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch {}
  }
  next();
});

const { verifyCsrfToken, requireAuth, requirePermission } = require('./middleware/security');

publicFiles(app);
app.use('/uploads', require('./routes/private_uploads'));
app.use('/api', async (_req,res,next) => {
  try { await database.ready; if(database.getDatabaseState().state !== 'ready') throw new Error('not ready'); next(); }
  catch { res.status(503).json({success:false,message:'قاعدة البيانات غير جاهزة'}); }
});

// حماية مسارات الـ API بـ CSRF Token
app.use('/api', verifyCsrfToken);

// مسارات واجهات برمجة التطبيقات (API Routes) مع التحقق الأمني
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/projects', requireAuth, require('./routes/projects'));
app.use('/api/inventory', requireAuth, require('./routes/inventory'));
app.use('/api/purchases', requireAuth, require('./routes/purchases'));
app.use('/api/expenses', requireAuth, require('./routes/expenses'));
app.use('/api/billing', requireAuth, require('./routes/billing'));
app.use('/api/payments', (req, res, next) => {
  if (req.path.startsWith('/webhook')) {
    return next();
  }
  return requireAuth(req, res, next);
}, require('./routes/payments'));
app.use('/api/accounting', requireAuth, require('./routes/accounting'));
app.use('/api/reports/payments', requireAuth, require('./routes/payment_reports'));
app.use('/api/reports', requireAuth, require('./routes/reports'));
app.use('/api/clients', requireAuth, require('./routes/clients'));
app.use('/api/supporting-documents', requireAuth, require('./routes/supporting_documents'));
app.use('/api/suppliers', requireAuth, require('./routes/suppliers'));
app.use('/api/vendors', requireAuth, require('./routes/suppliers'));
app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/hr', requireAuth, require('./routes/hr'));
app.use('/api/project-hub', requireAuth, require('./routes/project_management'));
app.use('/api/project-management', requireAuth, require('./routes/project_management'));
app.use('/api/project-files', requireAuth, require('./routes/project_files'));
app.use('/api/procurement', requireAuth, require('./routes/procurement'));
app.use('/api/bank-reconciliation', requireAuth, require('./routes/bank_reconciliation'));
app.use('/api/taxes-guarantees', requireAuth, require('./routes/taxes_guarantees'));
app.use('/api/project-control', requireAuth, require('./routes/project_control'));
app.use('/api/material-management', requireAuth, require('./routes/material_management'));
app.use('/api/project-closeout', requireAuth, require('./routes/project_closeout'));
app.use('/api/profitability', requireAuth, require('./routes/profitability'));
app.use('/api/cash-flow', requireAuth, require('./routes/cash_flow'));
app.use('/api/contracts', requireAuth, require('./routes/contract_lifecycle'));
app.use('/api/contracts', requireAuth, require('./routes/contract_alerts'));
app.use('/api/client-portal', require('./routes/client_portal'));
app.use('/api/admin/client-users', requireAuth, require('./routes/admin_client_users'));


// مسار توثيق الـ API التفاعلي ومواصفة OpenAPI 3.0
const docsModule = require('./routes/docs');
app.use('/api', (req,res,next) => /^\/(?:openapi|docs)(?:\/|$)/.test(req.path) ? requireAuth(req,res,()=>requirePermission('settings:users')(req,res,next)) : next(), docsModule.router);
app.get('/api-docs', requireAuth, requirePermission('settings:users'), (_req, res) => res.send(docsModule.renderDocsHtml()));

// Readiness checks the selected engine rather than returning a constant status.
app.get(['/api/health','/api/ready'], async (_req,res) => {
  let timer;
  try {
    await Promise.race([database.get('SELECT 1 AS ready'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),3000);})]);
    res.json({status:'online',ready:true,version:config.version,timestamp:new Date().toISOString()});
  } catch { res.status(503).json({status:'unavailable',ready:false}); }
  finally { clearTimeout(timer); }
});

// نقطة فحص إصدار النظام والبيئة التشغيلية
app.get('/api/version', (req, res) => {
  res.json({
    success: true,
    version: config.version,
    environment: config.env,
    port: config.port,
    system: config.appName,
    isDev: config.isDev,
    isStaging: config.isStaging,
    timestamp: new Date().toISOString()
  });
});

// أي مسار API غير معروف يرجع JSON دائماً بدلاً من صفحة HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `المسار غير موجود في الخادم: ${req.method} ${req.originalUrl}` });
});

// صفحة فحص وتشخيص اتصال WebSocket المباشر في حال تم طلبه عبر HTTP
app.get(['/ws/alerts', '/ws/contracts', '/ws'], requireAuth, (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      status: 'active',
      protocol: 'websocket',
      ws_url: `ws://${req.headers.host}/ws/alerts`,
      message: 'خادم WebSocket للتنبيهات التعاقدية الذكية يعمل بنجاح.'
    });
  }
  const host = String(req.headers.host || `localhost:${PORT}`).replace(/[^a-zA-Z0-9.:[\]-]/g,'');
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>خادم WebSocket التفاعلي - شركة رواسي عدن</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 25px; display: flex; justify-content: center; }
    .box { background: #1e293b; border: 1.5px solid #d4af37; border-radius: 12px; width: 100%; max-width: 620px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    h2 { color: #fbbf24; margin: 0 0 8px 0; display: flex; align-items: center; gap: 8px; font-size: 1.3rem; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin: 0 0 16px 0; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; margin-bottom: 16px; }
    .badge-ok { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; }
    .badge-wait { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .badge-err { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
    .code { background: #020617; border: 1px solid #334155; padding: 10px; border-radius: 6px; font-family: monospace; color: #38bdf8; direction: ltr; text-align: left; margin: 10px 0; font-size: 0.95rem; }
    .log-box { background: #0b1120; border: 1px solid #334155; border-radius: 8px; padding: 12px; height: 160px; overflow-y: auto; font-family: monospace; font-size: 0.82rem; margin-bottom: 16px; color: #cbd5e1; }
    .btn { background: linear-gradient(135deg, #d4af37, #997825); color: #000; font-weight: bold; border: none; padding: 9px 16px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; }
    .btn-sec { background: #334155; color: #fff; }
  </style>
</head>
<body>
  <div class="box">
    <h2>⚡ خادم التنبيهات الفورية (WebSocket)</h2>
    <p>بوابة الاتصال المباشر للأحداث والتنبيهات التعاقدية الحية في شركة رواسي عدن للهندسة والمقاولات.</p>
    <div><span id="stBadge" class="badge badge-wait">⚪ جاري فحص الاتصال...</span></div>
    <div style="font-size: 0.85rem; color: #cbd5e1;">عنوان الاتصال المباشر (WebSocket URL):</div>
    <div class="code" id="wsUrlText">ws://${host}/ws/alerts</div>
    <div style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 6px;">سجل الأحداث المباشرة (Event Log):</div>
    <div class="log-box" id="logBox"></div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <button class="btn" onclick="sendPing()">📡 إرسال فحص نبض (Ping)</button>
      <button class="btn btn-sec" onclick="reconnect()">🔄 إعادة الاتصال</button>
      <a class="btn btn-sec" href="/" style="text-decoration: none; display: inline-flex; align-items: center;">🏠 العودة للنظام الرئيسي</a>
    </div>
  </div>
  <script>
    let ws;
    const log = document.getElementById('logBox');
    const badge = document.getElementById('stBadge');
    const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/alerts';

    function addLog(text, color = '#cbd5e1') {
      const t = new Date().toLocaleTimeString('ar-YE');
      log.innerHTML += '<div style="color:' + color + ';">[' + t + '] ' + text + '</div>';
      log.scrollTop = log.scrollHeight;
    }

    async function init() {
      addLog('جاري الاتصال بـ ' + wsUrl + ' ...', '#94a3b8');
      try {
        const token = localStorage.getItem('rawasi_token') || sessionStorage.getItem('rawasi_token') || '';
        const response = await fetch('/api/auth/realtime-ticket',{method:'POST',headers:{Authorization:'Bearer '+token}});
        const data = await response.json();
        if(!response.ok || !data.ticket) throw new Error('سجل الدخول أولاً');
        ws = new WebSocket(wsUrl,['rawasi-auth','ticket.'+data.ticket]);
        ws.onopen = () => {
          badge.className = 'badge badge-ok';
          badge.innerHTML = '🟢 متصل بنجاح (WebSocket Online)';
          addLog('تم إتمام المصافحة بنجاح. الخادم جاهز لبث التنبيهات.', '#4ade80');
        };
        ws.onmessage = (e) => {
          addLog('رسالة واردة: ' + e.data, '#fbbf24');
        };
        ws.onerror = (e) => {
          badge.className = 'badge badge-err';
          badge.innerHTML = '🔴 خطأ في الاتصال';
          addLog('حدث خطأ في اتصال WebSocket', '#f87171');
        };
        ws.onclose = (e) => {
          badge.className = 'badge badge-err';
          badge.innerHTML = '⚪ مغلق (Closed: ' + e.code + ')';
          addLog('تم إغلاق الاتصال.', '#94a3b8');
        };
      } catch (err) {
        addLog('خطأ: ' + err.message, '#f87171');
      }
    }

    function sendPing() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        addLog('تم إرسال طلب فحص النبض (Ping)...', '#38bdf8');
      } else {
        addLog('الاتصال غير مفتوح حالياً.', '#f87171');
      }
    }

    function reconnect() {
      if (ws) ws.close();
      init();
    }

    init();
  </script>
</body>
</html>`);
});

app.use((_req,res)=>res.status(404).json({success:false,message:'المسار غير موجود'}));
app.use((error,_req,res,_next)=>{
  const status=Number(error.statusCode||error.status)||500;
  if(status>=500)console.error('Request failed:',error.code||error.name);
  if(!res.headersSent)res.status(status).json({success:false,message:status>=500?'تعذر إتمام الطلب':'الطلب غير صالح'});
});

if (require.main === module) {
  const http = require('http');
  const server = http.createServer(app);

  // ربط خادم WebSocket الأصلي (RFC 6455) قبل فتح المنفذ
  try {
    const contractAlertsService = require('./services/contractAlertsService');
    contractAlertsService.attachWebSocket(server);
  } catch (e) {
    console.error('⚠️ [ContractAlertsWebSocket] Failed to attach WebSocket:', e.message);
  }

  // تشغيل الخادم
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); });
  server.requestTimeout=120000; server.headersTimeout=65000;
  let stopping=false;
  async function shutdown(exitCode=0) {
    if(stopping)return; stopping=true;
    try { require('./services/backupSchedulerService').stop(); require('./services/materialAuditScheduler').stop(); } catch {}
    const timeout=setTimeout(()=>{for(const socket of sockets)socket.destroy();},10000); timeout.unref();
    await new Promise(resolve=>server.close(resolve));
    clearTimeout(timeout);
    try { await database.closeDatabase(); } catch {}
    process.exit(exitCode);
  }
  process.once('SIGTERM',()=>shutdown(0)); process.once('SIGINT',()=>shutdown(0));
  process.once('uncaughtException',error=>{console.error('Fatal server error:',error.code||error.name);shutdown(1);});
  process.once('unhandledRejection',error=>{console.error('Fatal async error:',error?.code||error?.name||'unknown');shutdown(1);});
  database.ready.then(()=>server.listen(PORT, '0.0.0.0', () => {
    if (process.send) process.send({type:'ready',port:server.address().port});
    console.log('===========================================================');
    console.log(`🚀 Rawasi Aden System Server is Running!`);
    console.log(`🌐 System URL: http://localhost:${PORT}`);
    console.log(`💼 Port:       ${PORT}`);
    console.log('===========================================================');

    if (!config.schedulersEnabled) return;

    // بدء خدمة الجدولة التلقائية للنسخ الاحتياطي
    try {
      const backupSchedulerService = require('./services/backupSchedulerService');
      backupSchedulerService.init().catch(err => {
        console.error('⚠️ [BackupScheduler] Error initializing scheduler:', err.message);
      });
    } catch (e) {
      console.error('⚠️ [BackupScheduler] Failed to load backupSchedulerService:', e.message);
    }

    // بدء خدمة مراقبة وجدولة الجرد الدوري التلقائي للمستودعات
    try {
      const materialAuditScheduler = require('./services/materialAuditScheduler');
      materialAuditScheduler.init();
    } catch (e) {
      console.error('⚠️ [MaterialAuditScheduler] Failed to load materialAuditScheduler:', e.message);
    }

    // بدء خدمة مراقبة وجدولة تنبيهات العقود الذكية
    try {
      const contractAlertsService = require('./services/contractAlertsService');
      contractAlertsService.startDailyAlertScheduler();
    } catch (e) {
      console.error('⚠️ [ContractAlertsScheduler] Failed to load contractAlertsService:', e.message);
    }

  })).catch(error=>{console.error('Startup failed:',error.code||error.name);process.exitCode=1;});

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('===========================================================');
      console.error(`⚠️  [Port Conflict] Port ${PORT} is already running!`);
      console.error('Startup refused because the configured port is occupied.');
      console.error('===========================================================');
      process.exit(1);
    } else {
      console.error('⚠️ [Server] Listen error:', err.message);
      shutdown(1);
    }
  });


}

module.exports = app;
