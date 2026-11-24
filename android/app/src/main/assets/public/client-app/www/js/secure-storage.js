/**
 * وحدة التخزين الآمن للجلسات والبيانات (Secure Storage Module)
 * تدعم Capacitor Preferences في بيئة Android وتنتقل تلقائياً لـ localStorage في المتصفح
 */

const SecureStorage = {
  isCapacitor: typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform(),

  async set(key, value) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    try {
      if (this.isCapacitor && window.Capacitor.Plugins?.Preferences) {
        await window.Capacitor.Plugins.Preferences.set({ key, value: stringValue });
      }
    } catch (e) {
      // Fallback
    }
    try {
      localStorage.setItem(`rawasi_client_${key}`, stringValue);
    } catch (e) {}
  },

  async get(key) {
    try {
      if (this.isCapacitor && window.Capacitor.Plugins?.Preferences) {
        const { value } = await window.Capacitor.Plugins.Preferences.get({ key });
        if (value !== null && value !== undefined) return value;
      }
    } catch (e) {}
    try {
      return localStorage.getItem(`rawasi_client_${key}`);
    } catch (e) {
      return null;
    }
  },

  async getJson(key) {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async remove(key) {
    try {
      if (this.isCapacitor && window.Capacitor.Plugins?.Preferences) {
        await window.Capacitor.Plugins.Preferences.remove({ key });
      }
    } catch (e) {}
    try {
      localStorage.removeItem(`rawasi_client_${key}`);
    } catch (e) {}
  },

  async clear() {
    try {
      if (this.isCapacitor && window.Capacitor.Plugins?.Preferences) {
        await window.Capacitor.Plugins.Preferences.clear();
      }
    } catch (e) {}
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(k => {
        if (k.startsWith('rawasi_client_')) localStorage.removeItem(k);
      });
    } catch (e) {}
  }
};

window.SecureStorage = SecureStorage;
