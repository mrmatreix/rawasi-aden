/**
 * وحدة إدارة جلسات ومصادقة العميل (Client Auth Module)
 */

const ClientAuth = {
  async getToken() {
    return await window.SecureStorage.get('token');
  },

  async getUser() {
    return await window.SecureStorage.getJson('user');
  },

  async isAuthenticated() {
    const token = await this.getToken();
    return Boolean(token);
  },

  /**
   * فحص تسجيل الدخول في الصفحات المحمية
   */
  async requireAuth() {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  },

  /**
   * تنفيذ تسجيل الدخول
   */
  async login(email, password) {
    try {
      const res = await window.ClientAPI.post('/auth/login', { email, password });
      if (!res.success) {
        throw new Error(res.message || 'فشل تسجيل الدخول');
      }

      if (res.requireOtp) {
        // يحتاج التحقق بالـ OTP
        await window.SecureStorage.set('temp_token', res.tempToken);
        return { requireOtp: true, message: res.message, debugOtp: res.debugOtp };
      }

      // تم الدخول مباشرة
      await window.SecureStorage.set('token', res.token);
      await window.SecureStorage.set('user', res.user);
      return { requireOtp: false, user: res.user };
    } catch (err) {
      throw err;
    }
  },

  /**
   * تأكيد رمز الـ OTP
   */
  async verifyOtp(otp, email) {
    try {
      const tempToken = await window.SecureStorage.get('temp_token');
      const res = await window.ClientAPI.post('/auth/verify-otp', {
        tempToken,
        otp,
        email
      });

      if (!res.success) {
        throw new Error(res.message || 'فشل التحقق من الرمز');
      }

      await window.SecureStorage.remove('temp_token');
      await window.SecureStorage.set('token', res.token);
      await window.SecureStorage.set('user', res.user);

      // تسجيل رمز الجهاز للإشعارات إن توفر
      if (window.PushNotificationsManager) {
        window.PushNotificationsManager.init();
      }

      return res;
    } catch (err) {
      throw err;
    }
  },

  /**
   * تسجيل الخروج
   */
  async logout() {
    try {
      await window.SecureStorage.clear();
      window.location.href = 'index.html';
    } catch {
      window.location.href = 'index.html';
    }
  }
};

window.ClientAuth = ClientAuth;
