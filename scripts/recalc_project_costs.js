/**
 * سكربت ترحيل توحيد التكلفة الفعلية (one-time + عند الحاجة)
 * ============================================================================
 * 1. يضيف عمودي الربط بالمصدر (source_table/source_id) لجدول المصروفات.
 * 2. يربط المصروفات المرآة القديمة (EXP-LAB / EXP-PUR) بمصادرها.
 * 3. ينشئ قيود المرايا المفقودة مع حركاتها النقدية (يتخطى الفترات المقفلة).
 * 4. يعيد احتساب actual_cost لكل المشاريع من المصادر الموحدة.
 *
 * التشغيل: npm run costs:recalc
 * آمن للتكرار (idempotent).
 */

const ProjectCostService = require('../server/services/projectCostService');

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('🔧 ترحيل توحيد التكلفة الفعلية للمشاريع');
  console.log('════════════════════════════════════════════════════════════');

  console.log('\n[1/4] التأكد من مخطط الربط (source_table/source_id)...');
  await ProjectCostService.ensureSchema();
  console.log('      ✅ المخطط جاهز');

  console.log('\n[2/4] ربط المصروفات المرآة القديمة بمصادرها...');
  const linked = await ProjectCostService.backfillMirrorLinks();
  console.log(`      ✅ تم ربط ${linked} مصروف مرآة`);

  console.log('\n[3/4] إنشاء قيود المرايا المفقودة (باكفيل no-voucher-without-JE)...');
  const mirrorJEs = await ProjectCostService.backfillMirrorJEs();
  console.log(`      ✅ قيود منشأة: ${mirrorJEs.created} — متخطاة (فترة مقفلة): ${mirrorJEs.skipped_closed}`);

  console.log('\n[4/4] إعادة احتساب التكلفة الفعلية لكل المشاريع...');
  const report = await ProjectCostService.recalculateAllProjects();
  console.log(`      ✅ تمت معالجة ${report.projects_count} مشروع\n`);

  console.log('┌──────┬──────────────┬──────────────────────────────┬──────────────┬──────────────┬──────────────┐');
  console.log('│ ID   │ الكود        │ المشروع                      │ قبل         │ بعد         │ الانحراف     │');
  console.log('├──────┼──────────────┼──────────────────────────────┼──────────────┼──────────────┼──────────────┤');
  for (const d of report.details) {
    const name = String(d.name || '').slice(0, 28).padEnd(28, ' ');
    console.log(
      `│ ${String(d.id).padEnd(4)} │ ${(d.code || '').padEnd(12)} │ ${name} │ ` +
      `${String(d.before.toLocaleString('en')).padStart(12)} │ ${String(d.after.toLocaleString('en')).padStart(12)} │ ` +
      `${String(d.drift.toLocaleString('en')).padStart(12)} │`
    );
  }
  console.log('└──────┴──────────────┴──────────────────────────────┴──────────────┴──────────────┴──────────────┘');

  const drifted = report.details.filter(d => Math.abs(d.drift) >= 0.01);
  console.log(`\n📌 مشاريع كان بها انحراف وصُحح: ${drifted.length} من ${report.projects_count}`);
  console.log('✅ اكتمل الترحيل بنجاح — التكلفة الآن من مصدر موحد واحد.');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ فشل الترحيل:', err.message);
  process.exit(1);
});
