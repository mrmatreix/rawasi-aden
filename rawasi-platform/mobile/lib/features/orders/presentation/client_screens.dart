import 'package:flutter/material.dart';
import '../../../core/contracts.dart';

class ClientPortalShell extends StatefulWidget {
  const ClientPortalShell({super.key, required this.session, required this.repository});
  final Session session; final RawasiRepository repository;
  @override State<ClientPortalShell> createState() => _ClientPortalShellState();
}
class _ClientPortalShellState extends State<ClientPortalShell> {
  int _tab = 0;
  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('أهلًا، ${widget.session.displayName}')),
    body: _tab == 0 ? NewServiceRequestScreen(repository: widget.repository) : ClientOrdersScreen(repository: widget.repository),
    bottomNavigationBar: NavigationBar(selectedIndex: _tab, onDestinationSelected: (value) => setState(() => _tab = value), destinations: const [
      NavigationDestination(icon: Icon(Icons.add_circle_outline), label: 'طلب خدمة'), NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'طلباتي'),
    ]),
  );
}

class NewServiceRequestScreen extends StatefulWidget {
  const NewServiceRequestScreen({super.key, required this.repository});
  final RawasiRepository repository;
  @override State<NewServiceRequestScreen> createState() => _NewServiceRequestScreenState();
}
class _NewServiceRequestScreenState extends State<NewServiceRequestScreen> {
  final _form = GlobalKey<FormState>(); final _description = TextEditingController();
  late Future<List<Region>> _regions; Future<List<ServiceOption>>? _services;
  String? _region, _service; bool _busy = false;
  @override void initState() { super.initState(); _regions = widget.repository.regions(); }
  @override void dispose() { _description.dispose(); super.dispose(); }
  Future<void> _send() async {
    if (!_form.currentState!.validate() || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.repository.createOrder(regionId: _region!, serviceId: _service!, description: _description.text.trim());
      if (mounted) { _description.clear(); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إرسال الطلب'))); }
    } catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إرسال الطلب، حاول لاحقًا'))); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override Widget build(BuildContext context) => FutureBuilder<List<Region>>(future: _regions, builder: (context, regions) {
    if (regions.hasError) return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [const Text('تعذر تحميل المناطق'), TextButton(onPressed: () => setState(() => _regions = widget.repository.regions()), child: const Text('إعادة المحاولة'))]));
    if (!regions.hasData) return const Center(child: CircularProgressIndicator());
    return Form(key: _form, child: ListView(padding: const EdgeInsets.all(20), children: [
      Text('طلب خدمة جديدة', style: Theme.of(context).textTheme.headlineSmall), const SizedBox(height: 8), const Text('اختر المنطقة والخدمة وأخبرنا بما تحتاجه.'), const SizedBox(height: 24),
      DropdownButtonFormField<String>(value: _region, decoration: const InputDecoration(labelText: 'المنطقة', border: OutlineInputBorder()), items: regions.data!.map((r) => DropdownMenuItem(value: r.id, child: Text(r.name))).toList(), onChanged: (v) => setState(() { _region = v; _service = null; _services = v == null ? null : widget.repository.services(v); }), validator: (v) => v == null ? 'اختر المنطقة' : null),
      const SizedBox(height: 16),
      if (_services != null) FutureBuilder<List<ServiceOption>>(future: _services, builder: (context, services) {
        if (services.hasError) return const Text('تعذر تحميل الخدمات');
        if (!services.hasData) return const LinearProgressIndicator();
        return DropdownButtonFormField<String>(value: _service, decoration: const InputDecoration(labelText: 'الخدمة', border: OutlineInputBorder()), items: services.data!.map((s) => DropdownMenuItem(value: s.id, child: Text(s.name))).toList(), onChanged: (v) => setState(() => _service = v), validator: (v) => v == null ? 'اختر الخدمة' : null);
      }),
      const SizedBox(height: 16), TextFormField(controller: _description, maxLines: 5, decoration: const InputDecoration(labelText: 'تفاصيل الطلب', border: OutlineInputBorder()), validator: (v) => v == null || v.trim().isEmpty ? 'أدخل تفاصيل الطلب' : null),
      const SizedBox(height: 20), FilledButton(onPressed: _busy || _service == null ? null : _send, child: Text(_busy ? 'جارٍ الإرسال...' : 'إرسال الطلب')),
    ]));
  });
}

class ClientOrdersScreen extends StatelessWidget {
  const ClientOrdersScreen({super.key, required this.repository}); final RawasiRepository repository;
  @override Widget build(BuildContext context) => FutureBuilder<List<OrderSummary>>(future: repository.orders(), builder: (context, snapshot) {
    if (snapshot.hasError) return const Center(child: Text('تعذر تحميل الطلبات'));
    if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
    if (snapshot.data!.isEmpty) return const Center(child: Text('لا توجد طلبات حتى الآن'));
    return ListView(padding: const EdgeInsets.all(16), children: snapshot.data!.map((order) => Card(child: ListTile(title: Text(order.number), subtitle: Text(order.description), trailing: const Icon(Icons.chevron_left), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ClientQuoteScreen(repository: repository, order: order)))))).toList());
  });
}

class ClientQuoteScreen extends StatefulWidget {
  const ClientQuoteScreen({super.key, required this.repository, required this.order}); final RawasiRepository repository; final OrderSummary order;
  @override State<ClientQuoteScreen> createState() => _ClientQuoteScreenState();
}
class _ClientQuoteScreenState extends State<ClientQuoteScreen> {
  final _note = TextEditingController(); bool _busy = false; late Future<ClientQuote?> _quote;
  @override void initState() { super.initState(); _quote = widget.repository.clientQuote(widget.order.id); }
  @override void dispose() { _note.dispose(); super.dispose(); }
  Future<void> _respond(bool accept) async {
    if (_note.text.trim().isEmpty) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('أدخل ملاحظتك قبل إرسال الرد'))); return; }
    setState(() => _busy = true);
    try { await widget.repository.respondToQuote(widget.order.id, accept: accept, note: _note.text.trim()); if (mounted) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إرسال ردك'))); Navigator.pop(context); } }
    catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إرسال الرد'))); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(widget.order.number)), body: FutureBuilder<ClientQuote?>(future: _quote, builder: (context, snapshot) {
    if (snapshot.hasError) return const Center(child: Text('تعذر تحميل العرض'));
    if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
    final quote = snapshot.data;
    if (quote == null) return const Center(child: Text('لم يُرسل عرض سعر لهذا الطلب بعد'));
    return ListView(padding: const EdgeInsets.all(20), children: [Text('عرض السعر', style: Theme.of(context).textTheme.headlineSmall), const SizedBox(height: 12),
      ...quote.lines.map((line) => ListTile(title: Text(line.label), subtitle: line.note == null ? null : Text(line.note!), trailing: Text('${line.amount} ${quote.currency}'))),
      const Divider(), ListTile(title: const Text('الإجمالي'), trailing: Text('${quote.total} ${quote.currency}')), const SizedBox(height: 16),
      if (widget.order.status == 'QUOTED_TO_CLIENT') ...[TextField(controller: _note, maxLines: 3, decoration: const InputDecoration(labelText: 'ملاحظتك على العرض', border: OutlineInputBorder())), const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : () => _respond(true), child: const Text('الموافقة على العرض')), OutlinedButton(onPressed: _busy ? null : () => _respond(false), child: const Text('رفض السعر وإرسال الملاحظة'))],
    ]);
  }));
}
