# فحص Railway الفعلي — 19 أكتوبر 2026

هذا فحص قراءة فقط؛ لم يُنفذ نشر أو إعادة تشغيل أو تعديل متغيرات أو إنشاء Volume.

| البند | المشاهدة |
|---|---|
| المشروع / الخدمة | skillful-recreation / rawasi-aden |
| البيئة | production |
| المستودع والفرع | mrmatreix/rawasi-aden / main |
| النشر النشط | 8a06c140-c6a8-4a72-aca2-89914efea22a |
| Commit | 07bcdbd0ca533ee8f6e9943ffa1ab7c3f90a7283 |
| مصدر النشر | GitHub، وانتظار CI مفعّل؛ تظهر عمليات سابقة skipped بسبب فشل CI |
| البناء | Railpack v0.41.0، Node 24.21.0، Bun 1.4.2 |
| المنطقة والنسخ | sfo، نسخة واحدة |
| إعادة التشغيل | On Failure، عشر محاولات |
| الأوامر والفحص | لا يظهر تجاوز مخصص للبناء أو التشغيل أو Healthcheck في ملخص النشر |
| HTTPS | الرابط العام يستجيب عبر HTTPS |
| محرك البيانات | سجل التشغيل يؤكد SQLite |
| Volume | لم تظهر وحدة تخزين في مخطط البنية؛ لم يثبت تخزين دائم |
| البيئة الفعلية | GET /api/version أعاد production والمنفذ 8080 |
| تعارض المحرر | محرر Variables يعرض NODE_ENV=development وRAWASI_DB_PATH=server/database/rawasi_aden.db؛ هذه القراءة لا تثبت تطبيقها على النشر النشط |
| أسماء المتغيرات الظاهرة | NODE_ENV، JWT_SECRET، MYSQL_HOST، MYSQL_PORT، MYSQL_USER، MYSQL_PASSWORD، MYSQL_DATABASE، RAWASI_DB_PATH، ONLINE_DB_URL، ONLINE_DB_KEY |
| أسرار مطلوبة غير ظاهرة | CLIENT_JWT_SECRET وBANK_ENCRYPTION_KEY، ولا يظهر DB_ENGINE أو RAWASI_DATA_DIR |
| حدود الموارد | الحد المعروض 8 vCPU و8 GB لكل نسخة؛ هذا سقف وليس استهلاكاً مقاساً أو فاتورة |

## أخطاء مؤكدة من سجل النشر

- `database disk image is malformed` في 17 و18 أكتوبر أثناء قراءة طلبات الخدمات. سلامة قاعدة الإنتاج الحالية غير مثبتة؛ يلزم استخراج نسخة آمنة وفحصها في بيئة منفصلة قبل أي إعادة نشر.
- `spawn explorer.exe ENOENT` و`spawn powershell.exe ENOENT` عند محاولة فتح مجلد على خادم Linux. عولج المسار في الفرع ليرجع تنزيل المستند أو رسالة واضحة بدلاً من تشغيل أوامر Windows على السحابة.
- HEAD للمصدر وقاعدة البيانات والإعدادات أعاد 200؛ لم تُنزّل قاعدة الإنتاج عبر هذه المسارات العامة.
- /api/health أعاد 200 ثابتاً رغم وجود أخطاء تلف في السجلات؛ لذلك لا يثبت سلامة القاعدة.

## تنبيه إعداد النشر

لوحة Railway ووثائقها الحالية تعلن إيقاف Config as Code. ملف railway.json ليس إعداداً فعالاً نعتمد عليه لهذه الخدمة. المثال القديم محفوظ للتوثيق فقط في railway.legacy.json.example.

اعتماد إعدادات الخدمة المقترحة يتم من اللوحة بعد الموافقة، أو بعد استيراد البنية الحالية بـ railway config pull ومراجعة railway config plan. لا يُنشأ تعريف IaC ناقص قد يحذف موارد موجودة.

المصدر: [وثائق Railway الحالية](https://docs.railway.com/infrastructure-as-code)، [إيقاف Config as Code](https://docs.railway.com/config-as-code).

لم تُختبر إعادة التشغيل أو Redeploy أو Rollback على الخدمة الحالية حفاظاً على البيانات وامتثالاً لطلب الاعتماد المسبق.

قائمة Environments أظهرت production فقط وNew Environment؛ لم تظهر بيئة staging ولم تُنشأ بيئة جديدة.
