import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/contracts.dart';

class SupervisorWorkspaceShell extends StatelessWidget {
  const SupervisorWorkspaceShell({super.key, required this.session, required this.repository});
  final Session session; final RawasiRepository repository;
  @override Widget build(BuildContext context) => StaffOrderList(title: 'طلبات المنفذ', session: session, repository: repository, isAdmin: false);
}
class AdminDashboardShell extends StatelessWidget {
  const AdminDashboardShell({super.key, required this.session, required this.repository});
  final Session session; final RawasiRepository repository;
  @override Widget build(BuildContext context) => StaffOrderList(title: 'مركز العروض', session: session, repository: repository, isAdmin: true);
}
class StaffOrderList extends StatefulWidget {
  const StaffOrderList({super.key, required this.title, required this.session, required this.repository, required this.isAdmin});
  final String title; final Session session; final RawasiRepository repository; final bool isAdmin;
  @override State<StaffOrderList> createState() => _StaffOrderListState();
}
class _StaffOrderListState extends State<StaffOrderList> {
  late Future<List<OrderSummary>> _orders;
  @override void initState() { super.initState(); _orders = widget.repository.orders(); }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(widget.title), actions: [IconButton(onPressed: () => setState(() => _orders = widget.repository.orders()), icon: const Icon(Icons.refresh), tooltip: 'تحديث')]),
    body: FutureBuilder<List<OrderSummary>>(future: _orders, builder: (context, snapshot) {
      if (snapshot.hasError) return const Center(child: Text('تعذر تحميل الطلبات'));
      if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
      if (snapshot.data!.isEmpty) return const Center(child: Text('لا توجد طلبات متاحة'));
      return ListView(padding: const EdgeInsets.all(16), children: snapshot.data!.map((order) => Card(child: ListTile(
        title: Text(order.number), subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(order.description), if (!widget.isAdmin && order.slaDeadline != null) SlaCountdown(deadline: order.slaDeadline!)]),
        trailing: const Icon(Icons.chevron_left), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => widget.isAdmin ? AdminQuoteScreen(repository: widget.repository, order: order) : SupervisorOrderScreen(repository: widget.repository, order: order))),
      ))).toList());
    }));
}
class SlaCountdown extends StatefulWidget {
  const SlaCountdown({super.key, required this.deadline}); final DateTime deadline;
  @override State<SlaCountdown> createState() => _SlaCountdownState();
}
class _SlaCountdownState extends State<SlaCountdown> {
  Timer? _timer;
  @override void initState() { super.initState(); _timer = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); }); }
  @override void dispose() { _timer?.cancel(); super.dispose(); }
  @override Widget build(BuildContext context) {
    final remaining = widget.deadline.difference(DateTime.now());
    if (remaining.isNegative) return Text('انتهت مهلة العرض', style: TextStyle(color: Theme.of(context).colorScheme.error));
    final minutes = remaining.inMinutes; final seconds = remaining.inSeconds % 60;
    return Text('الوقت المتبقي: $minutes:${seconds.toString().padLeft(2, '0')}');
  }
}
class _ExtraFields {
  final description = TextEditingController(), amount = TextEditingController(), reason = TextEditingController();
  void dispose() { description.dispose(); amount.dispose(); reason.dispose(); }
}
class SupervisorOrderScreen extends StatefulWidget {
  const SupervisorOrderScreen({super.key, required this.repository, required this.order});
  final RawasiRepository repository; final OrderSummary order;
  @override State<SupervisorOrderScreen> createState() => _SupervisorOrderScreenState();
}
class _SupervisorOrderScreenState extends State<SupervisorOrderScreen> {
  final _form = GlobalKey<FormState>(); final _base = TextEditingController(); final _baseReason = TextEditingController(); final _reject = TextEditingController();
  final List<_ExtraFields> _extras = []; String? _worker; bool _busy = false;
  late Future<List<Worker>> _workers; late Future<SupervisorRate> _rate;
  @override void initState() { super.initState(); _workers = widget.repository.workers(); _rate = widget.repository.supervisorRate(widget.order.id); }
  @override void dispose() { _base.dispose(); _baseReason.dispose(); _reject.dispose(); for (final e in _extras) { e.dispose(); } super.dispose(); }
  String? _required(String? value) => value == null || value.trim().isEmpty ? 'هذا الحقل مطلوب' : null;
  BigInt? _minor(String value) {
    final text = value.trim();
    if (!RegExp(r'^(0|[1-9]\d*)(\.\d{1,2})?$').hasMatch(text)) return null;
    final parts = text.split('.');
    return BigInt.parse(parts[0]) * BigInt.from(100) + BigInt.parse((parts.length > 1 ? parts[1] : '').padRight(2, '0'));
  }

  Future<void> _send() async {
    if (!_form.currentState!.validate() || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.repository.submitSupervisorQuote(widget.order.id, workerId: _worker!, baseCost: _base.text.trim(), baseReason: _baseReason.text.trim(), extraCosts: _extras.map((e) => CostInput(description: e.description.text.trim(), amount: e.amount.text.trim(), reason: e.reason.text.trim())).toList());
      if (mounted) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إرسال التسعير للمراجعة'))); Navigator.pop(context); }
    } catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إرسال التسعير'))); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _requestRejection() async {
    final reason = _reject.text.trim();
    if (reason.isEmpty) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اكتب سبب طلب الرفض'))); return; }
    setState(() => _busy = true);
    try { await widget.repository.requestRejection(widget.order.id, reason); if (mounted) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إرسال طلب الرفض للإدارة'))); Navigator.pop(context); } }
    catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إرسال طلب الرفض'))); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(widget.order.number)), body: FutureBuilder<List<Object>>(future: Future.wait([_workers, _rate]), builder: (context, snapshot) {
    if (snapshot.hasError) return const Center(child: Text('تعذر تحميل العمال وسقف التكلفة'));
    if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
    final workers = snapshot.data![0] as List<Worker>; final rate = snapshot.data![1] as SupervisorRate;
    return Form(key: _form, child: ListView(padding: const EdgeInsets.all(20), children: [
      Text(widget.order.description), const SizedBox(height: 12), if (widget.order.slaDeadline != null) SlaCountdown(deadline: widget.order.slaDeadline!),
      const SizedBox(height: 16), DropdownButtonFormField<String>(value: _worker, decoration: const InputDecoration(labelText: 'العامل المكلف'), items: workers.map((w) => DropdownMenuItem(value: w.id, child: Text(w.name))).toList(), onChanged: (value) => setState(() => _worker = value), validator: _required),
      const SizedBox(height: 12), Text('التكلفة المتفق عليها: ${rate.agreedBaseCost} ${rate.currency} • السقف: ${rate.maximumBaseCost} ${rate.currency}'),
      TextFormField(controller: _base, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'التكلفة الأساسية'), validator: (value) {
        final amount = _minor(value ?? ''); final ceiling = _minor(rate.maximumBaseCost);
        if (amount == null || ceiling == null) return 'أدخل مبلغًا صحيحًا';
        return amount > ceiling ? 'التكلفة تتجاوز السقف المتفق عليه' : null;
      }),
      TextFormField(controller: _baseReason, decoration: const InputDecoration(labelText: 'سبب تعديل التكلفة إن وجد'), validator: (value) {
        final amount = _minor(_base.text); final agreed = _minor(rate.agreedBaseCost);
        return amount != null && agreed != null && amount != agreed ? _required(value) : null;
      }),
      ..._extras.map((e) => Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [TextFormField(controller: e.description, decoration: const InputDecoration(labelText: 'البند الإضافي'), validator: _required), TextFormField(controller: e.amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'التكلفة'), validator: _required), TextFormField(controller: e.reason, decoration: const InputDecoration(labelText: 'سبب التكلفة'), validator: _required), TextButton(onPressed: () => setState(() { _extras.remove(e); e.dispose(); }), child: const Text('حذف البند'))])))),
      TextButton.icon(onPressed: () => setState(() => _extras.add(_ExtraFields())), icon: const Icon(Icons.add), label: const Text('إضافة تكلفة إضافية')),
      FilledButton(onPressed: _busy ? null : _send, child: const Text('إرسال التسعير للإدارة')), const Divider(height: 36), TextField(controller: _reject, maxLines: 3, decoration: const InputDecoration(labelText: 'مبرر طلب الرفض للإدارة')), OutlinedButton(onPressed: _busy ? null : _requestRejection, child: const Text('طلب رفض من الإدارة')),
    ]));
  }));
}

class AdminQuoteScreen extends StatefulWidget {
  const AdminQuoteScreen({super.key, required this.repository, required this.order}); final RawasiRepository repository; final OrderSummary order;
  @override State<AdminQuoteScreen> createState() => _AdminQuoteScreenState();
}
class _AdminQuoteScreenState extends State<AdminQuoteScreen> {
  late Future<AdminQuote?> _quote; bool _busy = false;
  @override void initState() { super.initState(); _quote = widget.repository.adminQuote(widget.order.id); }
  Future<void> _action({bool? returnToReview}) async {
    setState(() => _busy = true);
    try {
      if (returnToReview == null) { await widget.repository.approveQuote(widget.order.id); } else { await widget.repository.resolveRejection(widget.order.id, returnToReview: returnToReview); }
      if (mounted) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم حفظ القرار'))); Navigator.pop(context); }
    } catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر حفظ القرار'))); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(widget.order.number)), body: FutureBuilder<AdminQuote?>(future: _quote, builder: (context, snapshot) {
    if (snapshot.hasError) return const Center(child: Text('تعذر تحميل بيانات العرض'));
    if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
    final quote = snapshot.data;
    return ListView(padding: const EdgeInsets.all(20), children: [
      Text(widget.order.description), const SizedBox(height: 16),
      if (widget.order.status == 'REJECTION_REQUESTED') ...[const Text('طلب رفض بانتظار قرار الإدارة'), if (widget.order.adminRejectionReason != null) Text(widget.order.adminRejectionReason!), FilledButton(onPressed: _busy ? null : () => _action(returnToReview: true), child: const Text('إعادة الطلب للمراجعة')), OutlinedButton(onPressed: _busy ? null : () => _action(returnToReview: false), child: const Text('اعتماد الرفض'))],
      if (quote != null) ...[Text('مقارنة التكاليف والعرض', style: Theme.of(context).textTheme.titleLarge),
        ListTile(title: const Text('تكلفة المنفذ الأساسية'), trailing: Text('${quote.baseCost} ${quote.currency}')),
        ...quote.extraCosts.map((line) => ListTile(title: Text(line.label), subtitle: line.note == null ? null : Text(line.note!), trailing: Text('${line.amount} ${quote.currency}'))),
        ListTile(title: const Text('هامش رواسي'), trailing: Text('${quote.markupPercent}%')), ListTile(title: const Text('ربح رواسي'), trailing: Text('${quote.profit} ${quote.currency}')),
        const Divider(), const Text('ما سيظهر للعميل'), ...quote.clientQuote.lines.map((line) => ListTile(title: Text(line.label), trailing: Text('${line.amount} ${quote.currency}'))),
        ListTile(title: const Text('إجمالي العرض'), trailing: Text('${quote.clientQuote.total} ${quote.currency}')),
        if (widget.order.status == 'PENDING_ADMIN_APPROVAL') FilledButton(onPressed: _busy ? null : _action, child: const Text('اعتماد وإرسال العرض للعميل')),
      ] else if (widget.order.status != 'REJECTION_REQUESTED') const Text('لا يوجد عرض بانتظار المراجعة.'),
    ]);
  }));
}
