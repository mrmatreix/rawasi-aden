/**
 * وحدة إشعارات Capacitor / Android الذكية (Push Notifications)
 * لتطبيق عملاء رواسي عدن
 */

const PushNotificationsManager = {
  isCapacitor: typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform(),

  async init() {
    if (!this.isCapacitor || !window.Capacitor.Plugins?.PushNotifications) {
      console.log('Push notifications running in browser mock/in-app mode');
      return;
    }

    const PushNotifications = window.Capacitor.Plugins.PushNotifications;

    try {
      // 1. طلب الإذن
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== 'granted') {
        console.warn('User denied push notification permissions');
        return;
      }

      // 2. التسجيل في FCM للحصول على الرمز
      await PushNotifications.register();

      // 3. الاستماع لحدث استلام الرمز (Device Token)
      PushNotifications.addListener('registration', async (token) => {
        console.log('FCM Token received:', token.value);
        await window.ClientAPI.post('/device/register', {
          device_token: token.value,
          platform: 'android'
        });
      });

      // 4. الاستماع لوصول الإشعار أثناء استخدام التطبيق (Foreground)
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        window.ClientApp?.showToast(`${notification.title}: ${notification.body}`, 'info');
        window.ClientApp?.updateNotificationBadge();
      });

      // 5. الاستماع لنقر العميل على الإشعار
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification.data;
        if (data && data.referenceType === 'invoice') {
          window.location.href = 'invoices.html';
        } else if (data && data.referenceType === 'payment') {
          window.location.href = 'payments.html';
        } else {
          window.location.href = 'notifications.html';
        }
      });
    } catch (err) {
      console.error('Error initializing push notifications:', err);
    }
  }
};

window.PushNotificationsManager = PushNotificationsManager;
