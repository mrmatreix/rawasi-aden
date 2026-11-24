const express = require('express');
const router = express.Router();
const PaymentService = require('../services/paymentService');

/**
 * تقارير ونظام تحليلات تصنيف المدفوعات الخماسي
 */

// 1. تقرير توزيع المدفوعات حسب السياق
router.get('/by-context', async (req, res) => {
  try {
    const data = await PaymentService.getReportByContext(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تقرير سياق الدفع: ' + err.message });
  }
});

// 2. تقرير توزيع المدفوعات حسب الوسيلة
router.get('/by-instrument', async (req, res) => {
  try {
    const data = await PaymentService.getReportByInstrument(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تقرير وسيلة الدفع: ' + err.message });
  }
});

// 3. تقرير توزيع المدفوعات حسب القناة
router.get('/by-channel', async (req, res) => {
  try {
    const data = await PaymentService.getReportByChannel(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تقرير قناة الدفع: ' + err.message });
  }
});

// 4. تقرير توزيع المدفوعات حسب التوقيت
router.get('/by-timing', async (req, res) => {
  try {
    const data = await PaymentService.getReportByTiming(req.query);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تقرير توقيت الدفع: ' + err.message });
  }
});

// 5. تقرير توقعات التدفق النقدي (Cash Flow Forecast)
router.get('/cash-flow-forecast', async (req, res) => {
  try {
    const months = req.query.months || 6;
    const data = await PaymentService.getCashFlowForecast(months);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تقرير التدفق النقدي: ' + err.message });
  }
});

// 6. تقرير المعاملات المعلقة في المقاصة والتصفية (Pending Clearance)
router.get('/pending-clearance', async (req, res) => {
  try {
    const data = await PaymentService.getPendingClearance();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المعاملات المعلقة: ' + err.message });
  }
});

module.exports = router;
