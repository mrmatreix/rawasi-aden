/**
 * وحدة الاتصال بـ API بوابة العملاء (Client API Client)
 * تدعم:
 * - التحقق الإلزامي من JWT
 * - التخزين المؤقت للعمل دون اتصال (Offline Cache)
 * - كشف انقطاع الإنترنت وعرض تنبيه فوري
 * - إعادة المحاولة الآلية عند ضعف الشبكة
 */

const ClientAPI = {
  // عنوان خادم الـ API (يستخدم نفس خادم النظام)
  getBaseUrl() {
    if (typeof window !== 'undefined' && window.CLIENT_API_URL) {
      return window.CLIENT_API_URL;
    }
    // في بيئة المتصفح أو WebView
    if (window.location.origin && !window.location.origin.startsWith('file://')) {
      return window.location.origin;
    }
    // ربط التطبيق بالسيرفر الفعلي على الإنترنت
    return 'https://rawasi-aden-production.up.railway.app';
  },

  isOnline: navigator.onLine,

  init() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateOfflineBanner(false);
      window.ClientApp?.showToast('تمت استعادة الاتصال بالإنترنت', 'success');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateOfflineBanner(true);
      window.ClientApp?.showToast('أنت تعمل حالياً بدون اتصال (Offline)', 'error');
    });

    this.updateOfflineBanner(!navigator.onLine);
  },

  updateOfflineBanner(isOffline) {
    const banner = document.getElementById('offlineBanner');
    if (banner) {
      if (isOffline) {
        banner.classList.add('active');
        banner.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> لا يوجد اتصال بالإنترنت - يتم عرض آخر البيانات المحفوظة محلياً';
      } else {
        banner.classList.remove('active');
      }
    }
  },

  async request(endpoint, options = {}) {
    const url = `${this.getBaseUrl()}/api/client-portal${endpoint}`;
    const token = await window.SecureStorage.get('token');

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const cacheKey = `cache_${endpoint}`;

    // إذا كان الجهاز غير متصل بالإنترنت، جلب البيانات من الـ Cache إذا كان الطلب GET
    if (!navigator.onLine && (!options.method || options.method === 'GET')) {
      const cached = await window.SecureStorage.getJson(cacheKey);
      if (cached) {
        cached._fromOfflineCache = true;
        return cached;
      }
      throw new Error('لا يوجد اتصال بالإنترنت ولا تتوفر بيانات محفوظة محلياً');
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers
      });

      // التعامل مع انتهاء صلاحية الجلسة في المسارات المحمية فقط وليس مسارات المصادقة الأولية
      if (res.status === 401 && !endpoint.includes('/auth/')) {
        await window.SecureStorage.clear();
        if (!window.location.pathname.endsWith('index.html')) {
          window.location.href = 'index.html';
        }
        throw new Error('انتهت صلاحية جلسة تسجيل الدخول');
      }

      if (res.status === 429) {
        throw new Error('تم تجاوز عدد الطلبات المسموح بها، يرجى الانتظار دقيقة');
      }

      const data = await res.json();

      // حفظ نتائج GET الناجحة في الـ Cache تلقائياً لدعم الـ Offline
      if (res.ok && (!options.method || options.method === 'GET')) {
        await window.SecureStorage.set(cacheKey, data);
      }

      if (!res.ok) {
        throw new Error(data.message || `خطأ في الخادم (${res.status})`);
      }

      return data;
    } catch (err) {
      // محاولة استرجاع من الـ Cache عند فشل الاتصال بالشبكة
      if (!options.method || options.method === 'GET') {
        const cached = await window.SecureStorage.getJson(cacheKey);
        if (cached) {
          cached._fromOfflineCache = true;
          this.updateOfflineBanner(true);
          return cached;
        }
      }
      throw err;
    }
  },

  // اختصارات الطلبات
  get(endpoint) { return this.request(endpoint, { method: 'GET' }); },
  post(endpoint, body) { return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) }); },
  put(endpoint, body) { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }); }
};

window.ClientAPI = ClientAPI;
document.addEventListener('DOMContentLoaded', () => ClientAPI.init());
