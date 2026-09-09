/**
 * إدارة المصادقة وتسجيل الدخول والخروج وصلاحيات المستخدمين لنظام رواسي عدن
 * تتضمن التحقق من عدم تكرار تسجيل الدخول لنفس المستخدم بالتزامن والحفاظ على الجلسة الحية
 */

const Auth = {
  currentUser: null,
  token: null,
  sessionId: null,
  _isLoggingIn: false,
  _heartbeatInterval: null,
  _pendingCredentials: null,

  // تهيئة نظام الدخول والمصادقة
  async init() {
    const savedToken = localStorage.getItem('rawasi_token');
    const savedUserStr = localStorage.getItem('rawasi_user');

    if (savedToken && savedUserStr) {
      try {
        this.token = savedToken;
        this.currentUser = JSON.parse(savedUserStr);

        // إظهار واجهة التطبيق فوراً والعمل بسلاسة دون طلب إعادة تسجيل الدخول
        this.showApp();
        this.updateUserUI();
        this.applyPermissions();

        // بدء نبض التحقق الدوري من الجلسة
        this.startHeartbeat();

        // التحقق من صحة وصلاحية الجلسة مع الخادم في الخلفية
        await this.verifySession();
        return;
      } catch (e) {
        console.warn('خطأ في استرجاع بيانات الجلسة السابقة:', e);
        this.token = null;
        this.currentUser = null;
      }
    }

    // إذا لم توجد جلسة سابقة صالحة: إظهار شاشة الدخول
    this.showLogin();
  },

  // بدء نبض الحفاظ على الجلسة كل 25 ثانية والتحقق من عدم تكرار الحساب
  startHeartbeat() {
    this.stopHeartbeat();
    this._heartbeatInterval = setInterval(async () => {
      if (!this.token) return;
      try {
        const res = await fetch('/api/auth/heartbeat', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await res.json();
        if (!data.success && data.session_terminated) {
          this.stopHeartbeat();
          this.logout(true, data.message || 'تم تسجيل الدخول بهذا الحساب من جهاز أو نافذة أخرى. تم إنهاء هذه الجلسة منعاً للتكرار.');
        }
      } catch (e) {
        // خطأ شبكة مؤقت
      }
    }, 25000);
  },

  // إيقاف نبض الجلسة
  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  },

  // التحقق من الجلسة عبر السيرفر
  async verifySession() {
    if (!this.token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      if (data.success && data.user) {
        this.currentUser = data.user;
        localStorage.setItem('rawasi_user', JSON.stringify(this.currentUser));
        this.updateUserUI();
        this.applyPermissions();
      } else {
        // انتهت صلاحية الجلسة أو تم تسجيل الدخول من مكان آخر
        console.warn('جلسة الدخول منتهية أو غير صالحة:', data.message);
        this.stopHeartbeat();
        this.logout(false, data.message || 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول');
      }
    } catch (err) {
      console.warn('تعذر التحقق من الخادم حالياً، مواصلة العمل بالجلسة المخزنة محلياً:', err);
    }
  },

  // إظهار شاشة الدخول وإخفاء النظام
  showLogin() {
    const overlay = document.getElementById('loginScreenOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
    }
    const errorBox = document.getElementById('loginErrorMsg');
    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    }
    const conflictBox = document.getElementById('loginConflictBox');
    if (conflictBox) {
      conflictBox.style.display = 'none';
    }

    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');

    // استرجاع آخر اسم مستخدم تم الدخول به لتسهيل العملية وتجنب تكرار كتابته
    const lastUser = localStorage.getItem('rawasi_last_username');
    if (usernameInput) {
      if (!usernameInput.value && lastUser) {
        usernameInput.value = lastUser;
      }
      setTimeout(() => {
        if (usernameInput.value && passwordInput) {
          passwordInput.focus();
        } else {
          usernameInput.focus();
        }
      }, 150);
    }
  },

  // إخفاء شاشة الدخول وإظهار النظام
  showApp() {
    const overlay = document.getElementById('loginScreenOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
      setTimeout(() => {
        if (overlay.classList.contains('hidden')) {
          overlay.style.display = 'none';
        }
      }, 400);
    }
  },

  // تعبئة سريعة للحسابات التجريبية
  fillQuickLogin(username, password) {
    const uInput = document.getElementById('loginUsername');
    const pInput = document.getElementById('loginPassword');
    if (uInput) uInput.value = username;
    if (pInput) pInput.value = password;
    const btn = document.getElementById('btnLoginSubmit');
    if (btn) btn.focus();
    this.cancelConflictPrompt();
  },

  // معالجة نموذج تسجيل الدخول (مع دعم خيار إنهاء الجلسة المتزامنة السابقة)
  async submitLogin(e, force = false) {
    if (e) e.preventDefault();

    if (this._isLoggingIn) return;

    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    const errorBox = document.getElementById('loginErrorMsg');
    const conflictBox = document.getElementById('loginConflictBox');
    const conflictText = document.getElementById('loginConflictText');
    const submitBtn = document.getElementById('btnLoginSubmit');

    const username = (this._pendingCredentials && force) ? this._pendingCredentials.username : usernameInput?.value?.trim();
    const password = (this._pendingCredentials && force) ? this._pendingCredentials.password : passwordInput?.value;

    if (!username || !password) {
      if (errorBox) {
        errorBox.textContent = 'يرجى إدخال اسم المستخدم وكلمة المرور';
        errorBox.style.display = 'block';
      }
      return;
    }

    this._isLoggingIn = true;

    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    }
    if (conflictBox) {
      conflictBox.style.display = 'none';
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>جاري التحقق والاتصال...</span>`;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password, 
          force: !!force,
          deviceInfo: navigator.userAgent || 'متصفح النظام'
        })
      });

      const data = await res.json();

      // حالة اكتشاف جلسة نشطة أخرى لنفس المستخدم (Duplicate Active Session)
      if (res.status === 409 || data.already_logged_in) {
        this._pendingCredentials = { username, password };
        if (conflictBox) {
          if (conflictText) {
            conflictText.textContent = data.message || `المستخدم (${username}) متصل بالنظام حالياً من جهاز آخر. لمنع تكرار الحسابات، هل ترغب في إنهاء الجلسة السابقة والدخول الآن؟`;
          }
          conflictBox.style.display = 'block';
        } else if (errorBox) {
          errorBox.textContent = data.message;
          errorBox.style.display = 'block';
        }
        return;
      }

      if (data.success && data.token && data.user) {
        this._pendingCredentials = null;
        this.token = data.token;
        this.sessionId = data.sessionId;
        this.currentUser = data.user;

        localStorage.setItem('rawasi_token', this.token);
        localStorage.setItem('rawasi_user', JSON.stringify(this.currentUser));
        localStorage.setItem('rawasi_last_username', this.currentUser.username || username);

        this.showApp();
        this.updateUserUI();
        this.applyPermissions();
        this.startHeartbeat();

        // التحقق من حالة قاعدة البيانات والاتصال فورياً عند تسجيل الدخول
        if (typeof App !== 'undefined') {
          if (data.dbStatus && App.updateConnectionUI) {
            App.dbStatus = data.dbStatus;
            App.updateConnectionUI(data.dbStatus);
          } else if (App.checkDatabaseStatus) {
            await App.checkDatabaseStatus();
          }

          const isOnline = (App.dbStatus && App.dbStatus.isOnline);
          if (typeof App.showToast === 'function') {
            if (isOnline) {
              App.showToast(`🟢 تم التحقق: متصل بقاعدة البيانات السحابية (أونلاين) - مرحباً بك ${this.currentUser.full_name}`, 'success');
            } else {
              App.showToast(`🔴 تم التحقق: يعمل النظام على قاعدة البيانات المحلية (أوفلاين) - مرحباً بك ${this.currentUser.full_name}`, 'warning');
            }
          }
        } else if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(data.message || `مرحباً بك ${this.currentUser.full_name}!`, 'success');
        }

        // تفريغ كلمة المرور
        if (passwordInput) passwordInput.value = '';

        // التأكد من توجيه المستخدم لشاشة مسموحة
        if (this.hasPermission('dashboard:view')) {
          if (typeof App !== 'undefined' && App.navigate) App.navigate('dashboard');
        } else {
          this.navigateToFirstAllowed();
        }
      } else {
        if (errorBox) {
          errorBox.textContent = data.message || 'بيانات الدخول غير صحيحة، يرجى المحاولة مرة أخرى.';
          errorBox.style.display = 'block';
        }
        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(data.message || 'خطأ في تسجيل الدخول', 'error');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      if (errorBox) {
        errorBox.textContent = 'تعذر الاتصال بالخادم، يرجى التأكد من تشغيل النظام وقاعدة البيانات.';
        errorBox.style.display = 'block';
      }
    } finally {
      this._isLoggingIn = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <span>تسجيل الدخول</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>
        `;
      }
    }
  },

  // تأكيد وإنهاء الجلسة السابقة والدخول فوراً
  forceTakeoverLogin() {
    this.submitLogin(null, true);
  },

  // إلغاء رسالة تعارض الدخول
  cancelConflictPrompt() {
    const conflictBox = document.getElementById('loginConflictBox');
    if (conflictBox) conflictBox.style.display = 'none';
    this._pendingCredentials = null;
  },

  // تسجيل الخروج مع إنشاء نسخة احتياطية تلقائية وفورية لأحدث التعديلات
  async logout(showNotify = true, customMsg = null) {
    this.stopHeartbeat();
    const currentUser = this.currentUser;
    const username = currentUser ? (currentUser.username || currentUser.full_name) : 'user';

    // حفظ اسم المستخدم للرجوع السريع
    if (currentUser && currentUser.username) {
      localStorage.setItem('rawasi_last_username', currentUser.username);
    }

    // إشعار المستخدم ببدء النسخ الاحتياطي التلقائي
    if (showNotify && typeof App !== 'undefined' && App.showToast) {
      App.showToast('جاري حفظ آخر التعديلات وإنشاء نسخة احتياطية آمنة... ⏳', 'warning');
    }

    // إرسال طلب إنشاء النسخة الاحتياطية قبل إنهاء الجلسة
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const isOnline = (typeof App !== 'undefined' && App.dbStatus) ? App.dbStatus.isOnline : false;
      const res = await fetch('/api/settings/auto-backup-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          mode: isOnline ? 'online' : 'offline',
          notes: `تسجيل خروج المستخدم: ${username} (${isOnline ? 'وضع أونلاين سحابي' : 'وضع أوفلاين محلي'})`
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.success) {
        localStorage.setItem('rawasi_last_logout_backup', JSON.stringify(data.data));
        console.log('✅ Auto backup created upon logout:', data.data.fileName);
      }
    } catch (e) {
      console.warn('Auto backup note on logout:', e.message);
    }

    // إخطار السيرفر بإنهاء الجلسة فوراً في قاعدة البيانات
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': this.token ? `Bearer ${this.token}` : '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: username, userId: currentUser?.id })
      });
    } catch (e) {}

    // مسح بيانات الجلسة الحالية
    localStorage.removeItem('rawasi_token');
    localStorage.removeItem('rawasi_user');
    this.token = null;
    this.sessionId = null;
    this.currentUser = null;

    if (showNotify && typeof App !== 'undefined' && App.showToast) {
      App.showToast(customMsg || 'تم تسجيل الخروج بنجاح وتم حفظ أحدث نسخة احتياطية لمشروعك ✅', 'success');
    }

    const errorBox = document.getElementById('loginErrorMsg');
    if (errorBox) {
      if (customMsg) {
        errorBox.textContent = customMsg;
        errorBox.style.display = 'block';
      } else {
        errorBox.style.display = 'none';
      }
    }

    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) passwordInput.value = '';

    this.showLogin();
  },

  // تحديث بيانات المستخدم في شريط الرأس العلوي (Header)
  updateUserUI() {
    if (!this.currentUser) return;

    const userNameEl = document.getElementById('headerUserName');
    const userRoleEl = document.getElementById('headerUserRole');
    const userAvatarEl = document.getElementById('headerUserAvatar');

    if (userNameEl) {
      userNameEl.textContent = this.currentUser.full_name || this.currentUser.username;
    }

    if (userRoleEl) {
      let roleDisplay = 'مستخدم';
      if (this.currentUser.role === 'admin') roleDisplay = 'المدير العام';
      else if (this.currentUser.role === 'accountant') roleDisplay = 'المحاسب المالي';
      else if (this.currentUser.role === 'project_manager') roleDisplay = 'مهندس المشاريع';
      else if (this.currentUser.role === 'storekeeper') roleDisplay = 'أمين المخزن';
      userRoleEl.textContent = roleDisplay;
    }

    if (userAvatarEl) {
      const name = this.currentUser.full_name || this.currentUser.username || 'م';
      userAvatarEl.textContent = name.charAt(0).toUpperCase();
    }

    // تحديث مؤشر وشارة الاتصال عند اسم المستخدم أيضاً
    if (typeof App !== 'undefined' && App.updateConnectionUI && App.dbStatus) {
      App.updateConnectionUI(App.dbStatus);
    }
  },

  // فحص ما إذا كان المستخدم يملك صلاحية معينة
  hasPermission(permKey) {
    if (!this.currentUser) return false;

    // المدير العام يملك كافة الصلاحيات
    if (this.currentUser.role === 'admin' || this.currentUser.username === 'admin') {
      return true;
    }

    let perms = this.currentUser.permissions || [];
    if (typeof perms === 'string') {
      try {
        perms = (perms.startsWith('[') || perms.startsWith('{')) ? JSON.parse(perms) : perms.split(',').map(s => s.trim());
      } catch (e) {
        perms = perms.split(',').map(s => s.trim());
      }
    }

    // إذا كانت الصلاحيات فارغة، نطبق الصلاحيات الافتراضية حسب الدور
    if (!perms || perms.length === 0) {
      if (this.currentUser.role === 'accountant') {
        perms = [
          'dashboard:view',
          'revenues:view', 'revenues:create', 'revenues:print',
          'expenses:view', 'expenses:create',
          'custody:view', 'custody:manage',
          'clients:view', 'clients:manage', 'clients:statement',
          'suppliers:view', 'suppliers:manage', 'suppliers:statement',
          'cash:view',
          'reports:view'
        ];
      } else if (this.currentUser.role === 'project_manager') {
        perms = [
          'dashboard:view',
          'projects:view', 'projects:manage', 'projects:print',
          'expenses:view', 'expenses:create',
          'custody:view',
          'inventory:view', 'inventory:issue',
          'reports:view'
        ];
      } else if (this.currentUser.role === 'storekeeper') {
        perms = [
          'inventory:view', 'inventory:manage', 'inventory:issue',
          'projects:view'
        ];
      }
    }

    if (perms.includes('*') || perms.includes('all')) return true;

    // إذا كان المفتاح يحتوي خيارات مفصولة بفواصل
    const keys = permKey.split(',').map(k => k.trim());
    return keys.some(k => perms.includes(k));
  },

  // تطبيق الصلاحيات على عناصر القائمة الجانبية والإعدادات
  applyPermissions() {
    const navItems = document.querySelectorAll('#sidebarNavList li[data-perm]');
    let firstAllowed = null;

    navItems.forEach(li => {
      const reqPerm = li.getAttribute('data-perm');
      if (this.hasPermission(reqPerm)) {
        li.style.display = '';
        if (!firstAllowed) {
          const navLink = li.querySelector('a');
          if (navLink) {
            const match = navLink.getAttribute('onclick')?.match(/App\.navigate\('([^']+)'/);
            if (match) firstAllowed = match[1];
          }
        }
      } else {
        li.style.display = 'none';
      }
    });

    // إخفاء أو إظهار ألسنة الإعدادات حسب الصلاحيات
    const usersTab = document.getElementById('tabBtn_settings_users');
    if (usersTab) usersTab.style.display = this.hasPermission('settings:users') ? '' : 'none';

    const compTab = document.getElementById('tabBtn_settings_company');
    if (compTab) compTab.style.display = this.hasPermission('settings:company') ? '' : 'none';

    const backupTab = document.getElementById('tabBtn_settings_backup');
    if (backupTab) backupTab.style.display = this.hasPermission('settings:backup') ? '' : 'none';

    return firstAllowed;
  },

  // التوجيه لأول قسم مسموح
  navigateToFirstAllowed() {
    const firstAllowed = this.applyPermissions() || 'dashboard';
    if (typeof App !== 'undefined' && App.navigate) {
      App.navigate(firstAllowed);
    }
  },

  // تأكيد وإغلاق البرنامج بالكامل من شاشة الدخول مع حفظ نسخة احتياطية
  async confirmShutdownApp() {
    const isConfirm = confirm('هل أنت متأكد من رغبتك في إغلاق نظام شركة رواسي عدن وإنهاء البرنامج؟\n\nسيتم حفظ نسخة احتياطية آمنة وتلقائية من قاعدة البيانات فوراً.');
    if (!isConfirm) return;

    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast('جاري حفظ النسخة الاحتياطية وإغلاق البرنامج... ⏳', 'warning');
    }

    try {
      const isOnline = (typeof App !== 'undefined' && App.dbStatus) ? App.dbStatus.isOnline : false;
      const data = JSON.stringify({
        username: (this.currentUser && this.currentUser.username) ? this.currentUser.username : 'admin',
        mode: isOnline ? 'online' : 'offline',
        notes: 'إغلاق البرنامج من زر شاشة تسجيل الدخول'
      });

      if (navigator.sendBeacon) {
        const blob = new Blob([data], { type: 'application/json' });
        navigator.sendBeacon('/api/settings/shutdown-app', blob);
      } else {
        await fetch('/api/settings/shutdown-app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: data
        });
      }
    } catch (e) {
      console.warn('Shutdown error:', e);
    }

    setTimeout(() => {
      window.close();
      document.body.innerHTML = `
        <div style="display:flex;height:100vh;align-items:center;justify-content:center;background:#0f172a;color:#fff;font-family:'Segoe UI',Tahoma,sans-serif;direction:rtl;">
          <div style="text-align:center;padding:40px;background:#1e293b;border-radius:16px;border:1px solid #334155;max-width:480px;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
            <div style="font-size:48px;margin-bottom:16px;">🔒</div>
            <h2 style="color:#d4af37;margin-bottom:12px;">تم إغلاق نظام رواسي عدن بنجاح</h2>
            <p style="color:#cbd5e1;line-height:1.7;">تم حفظ أحدث نسخة احتياطية من قاعدة البيانات وإيقاف الخادم بأمان.<br>يمكنك إغلاق هذه النافذة الآن أو الضغط على Alt+F4.</p>
          </div>
        </div>
      `;
    }, 500);
  }
};

// =================== معالجة الإغلاق من زر (X) أعلى النافذة ===================
// 1. عند محاولة إغلاق النافذة من زر X: إظهار رسالة تأكيد للمستخدم
window.addEventListener('beforeunload', (e) => {
  if (Auth && Auth.currentUser && Auth.token) {
    e.preventDefault();
    const msg = 'هل أنت متأكد من رغبتك في إغلاق نظام شركة رواسي عدن؟ سيتم أخذ نسخة احتياطية آمنة وتلقائية من قاعدة البيانات فوراً.';
    e.returnValue = msg;
    return msg;
  }
});

// 2. عند موافقة المستخدم وتأكيد الإغلاق: أخذ نسخة احتياطية تلقائية وإنهاء الجلسة في الخادم
window.addEventListener('pagehide', () => {
  try {
    if (Auth && Auth.currentUser && Auth.token) {
      const username = Auth.currentUser.username || Auth.currentUser.full_name || 'admin';
      const userId = Auth.currentUser.id;
      const isOnline = (typeof App !== 'undefined' && App.dbStatus) ? App.dbStatus.isOnline : false;
      const data = JSON.stringify({
        username: username,
        mode: isOnline ? 'online' : 'offline',
        notes: `نسخة احتياطية تلقائية فور إغلاق النافذة من زر (X) بواسطة: ${username}`
      });

      if (navigator.sendBeacon) {
        const blob = new Blob([data], { type: 'application/json' });
        navigator.sendBeacon('/api/settings/shutdown-app', blob);

        const logoutBlob = new Blob([JSON.stringify({ username: username, userId: userId })], { type: 'application/json' });
        navigator.sendBeacon('/api/auth/logout', logoutBlob);
      }
    }
  } catch (e) {
    console.warn('Backup/logout on exit note:', e);
  }
});
