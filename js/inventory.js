/**
 * إدارة المخزون والمواد وأذونات الصرف للمشاريع - شركة رواسي عدن
 */

const Inventory = {
  items: [],

  async init() {
    await this.loadItems();
  },

  async loadItems() {
    try {
      const res = await fetch('/api/inventory/items');
      const json = await res.json();
      if (json.success) {
        this.items = json.data;
        this.renderItemsTable();
      }
    } catch (e) {
      console.error('Error loading items:', e);
    }
  },

  renderItemsTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 14px;">لا توجد مواد مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map(item => `
      <tr>
        <td><strong>${item.code}</strong></td>
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>${item.unit}</td>
        <td style="font-weight: 700; color: ${item.current_quantity <= item.min_quantity ? 'var(--accent-red)' : 'var(--text-primary)'}">
          ${item.current_quantity} ${item.unit}
          ${item.current_quantity <= item.min_quantity ? '<span class="badge badge-expense" style="margin-right: 6px;">نقص مخزون!</span>' : ''}
        </td>
        <td>${App.formatNumber(item.unit_price)} ${item.currency || 'ر.ي'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="Inventory.openIssueModal(${item.id})">
            صرف لمشروع
          </button>
        </td>
      </tr>
    `).join('');
  },

  openNewItemModal() {
    App.openModal('newItemModal');
  },

  async submitNewItem(e) {
    e.preventDefault();
    const name = document.getElementById('itemName').value.trim();
    const category = document.getElementById('itemCategory').value;
    const unit = document.getElementById('itemUnit').value;
    const current_quantity = document.getElementById('itemQty').value;
    const min_quantity = document.getElementById('itemMinQty').value || 10;
    const unit_price = document.getElementById('itemPrice').value || 0;
    const currency = document.getElementById('itemCurrency')?.value || 'ر.ي';

    if (!name || !unit) {
      App.showToast('اسم الصنف ووحدة القياس مطلوبان', 'error');
      return;
    }

    try {
      const res = await fetch('/api/inventory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, unit, current_quantity, min_quantity, unit_price, currency })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تمت إضافة الصنف للمخزن بنجاح', 'success');
        App.closeModal('newItemModal');
        document.getElementById('newItemForm').reset();
        await this.loadItems();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  openIssueModal(itemId) {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;

    const select = document.getElementById('issueProjectSelect');
    if (select) {
      select.innerHTML = `<option value="">اختر المشروع...</option>` +
        Projects.list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }

    document.getElementById('issueItemId').value = item.id;
    document.getElementById('issueItemName').textContent = `${item.name} (المتوفر: ${item.current_quantity} ${item.unit})`;
    document.getElementById('issueUnitLabel').textContent = item.unit;

    App.openModal('issueMaterialModal');
  },

  async submitIssueMaterial(e) {
    e.preventDefault();
    const item_id = document.getElementById('issueItemId').value;
    const project_id = document.getElementById('issueProjectSelect').value;
    const quantity = document.getElementById('issueQuantity').value;
    const recipient = document.getElementById('issueRecipient').value;
    const notes = document.getElementById('issueNotes').value;

    if (!item_id || !project_id || !quantity || Number(quantity) <= 0) {
      App.showToast('يرجى تحديد المشروع والكمية المطلوب صرفها', 'error');
      return;
    }

    try {
      const res = await fetch('/api/inventory/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id,
          project_id,
          type: 'out',
          quantity,
          recipient,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم صرف المادة بنجاح (${data.reference_no}) وإضافتها لتكلفة المشروع`, 'success');
        App.closeModal('issueMaterialModal');
        document.getElementById('issueMaterialForm').reset();
        await this.loadItems();
        await Projects.loadProjects();
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  }
};
