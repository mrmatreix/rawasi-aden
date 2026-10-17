const fs = require('fs');
const path = require('path');

const targetFiles = [
  path.join(__dirname, '..', 'index.html'),
  path.join(__dirname, '..', 'www', 'index.html'),
  path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'public', 'index.html')
];

const oldBlock = `        <!-- شريط الإجراءات السريعة داخل النافذة -->
        <div style="display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap;">
          <button class="btn btn-primary btn-sm" onclick="App.openNewProjectForClientFromChain()" style="background: var(--accent-blue); border-color: var(--accent-blue);">
            <span>🏗️ إضافة مشروع جديد للعميل</span>
          </button>
          <button class="btn btn-primary btn-sm" onclick="App.openNewClientBillFromChain()">
            <span>➕ إصدار مستخلص جديد مرتبط</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="App.openReceiptForClientFromChain()" style="border-color: var(--accent-green); color: var(--accent-green);">
            <span>💵 قبض دفعة / سداد مستخلص</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="App.openClientStatementFromChain()">
            <span>📄 كشف حساب العميل</span>
          </button>
        </div>

        <!-- تبويبات تفصيلية داخل نافذة السلسلة -->
        <div class="settings-tabs" style="margin-bottom: 14px; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px;">
          <button class="tab-btn active" id="chainTabBtnHierarchy" onclick="App.switchChainTab('hierarchy')">🌳 الشجرة الهرمية للعميل</button>
          <button class="tab-btn" id="chainTabBtnBills" onclick="App.switchChainTab('bills')">📑 المستخلصات والمطالبات (<span id="chainTabBillsCount">0</span>)</button>
          <button class="tab-btn" id="chainTabBtnReceipts" onclick="App.switchChainTab('receipts')">💰 سندات القبض والتحصيلات (<span id="chainTabReceiptsCount">0</span>)</button>
          <button class="tab-btn" id="chainTabBtnRetention" onclick="App.switchChainTab('retention')">🛡️ سجل محتجزات الضمان</button>
        </div>`;

const newBlock = `        <!-- شريط الإجراءات السريعة داخل النافذة -->
        <div class="chain-quick-actions">
          <button class="btn btn-primary btn-sm btn-chain-action btn-chain-project" onclick="App.openNewProjectForClientFromChain()">
            <span>🏗️ إضافة مشروع جديد للعميل</span>
          </button>
          <button class="btn btn-primary btn-sm btn-chain-action btn-chain-bill" onclick="App.openNewClientBillFromChain()">
            <span>➕ إصدار مستخلص جديد مرتبط</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-chain-action btn-chain-receipt" onclick="App.openReceiptForClientFromChain()">
            <span>💵 قبض دفعة / سداد مستخلص</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-chain-action btn-chain-statement" onclick="App.openClientStatementFromChain()">
            <span>📄 كشف حساب العميل</span>
          </button>
        </div>

        <!-- تبويبات تفصيلية داخل نافذة السلسلة (Modern Glassmorphic Tab Bar) -->
        <div class="settings-tabs chain-tabs-bar" id="chainTabsNav">
          <button class="tab-btn active" id="chainTabBtnHierarchy" onclick="App.switchChainTab('hierarchy')">
            <span class="tab-icon">🌳</span>
            <span class="tab-label">الشجرة الهرمية للعميل</span>
          </button>
          <button class="tab-btn" id="chainTabBtnBills" onclick="App.switchChainTab('bills')">
            <span class="tab-icon">📑</span>
            <span class="tab-label">المستخلصات والمطالبات</span>
            <span class="tab-count-badge" id="chainTabBillsCount">0</span>
          </button>
          <button class="tab-btn" id="chainTabBtnReceipts" onclick="App.switchChainTab('receipts')">
            <span class="tab-icon">💰</span>
            <span class="tab-label">سندات القبض والتحصيلات</span>
            <span class="tab-count-badge" id="chainTabReceiptsCount">0</span>
          </button>
          <button class="tab-btn" id="chainTabBtnRetention" onclick="App.switchChainTab('retention')">
            <span class="tab-icon">🛡️</span>
            <span class="tab-label">سجل محتجزات الضمان</span>
          </button>
        </div>`;

targetFiles.forEach(file => {
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');
  // Normalize CRLF to LF for matching
  const hasCRLF = text.includes('\r\n');
  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedOld = oldBlock.replace(/\r\n/g, '\n');
  const normalizedNew = newBlock.replace(/\r\n/g, '\n');

  if (normalizedText.includes(normalizedOld)) {
    const replaced = normalizedText.replace(normalizedOld, normalizedNew);
    fs.writeFileSync(file, hasCRLF ? replaced.replace(/\n/g, '\r\n') : replaced, 'utf8');
    console.log(`✓ Updated buttons in ${file}`);
  } else {
    console.warn(`! Target block not found in ${file}`);
  }
});
