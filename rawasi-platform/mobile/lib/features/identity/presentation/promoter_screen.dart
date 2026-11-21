import 'package:flutter/material.dart';
import '../../../core/contracts.dart';

class PromoterTabletOnboardingScreen extends StatefulWidget {
  const PromoterTabletOnboardingScreen({super.key, required this.session, required this.repository});
  final Session session; final RawasiRepository repository;
  @override State<PromoterTabletOnboardingScreen> createState() => _PromoterTabletOnboardingScreenState();
}
class _PromoterTabletOnboardingScreenState extends State<PromoterTabletOnboardingScreen> {
  final _key = GlobalKey<FormState>(); final _company = TextEditingController(); final _contact = TextEditingController(); final _phone = TextEditingController();
  bool _busy = false; IssuedMembership? _membership;
  @override void dispose() { _company.dispose(); _contact.dispose(); _phone.dispose(); super.dispose(); }
  String? _required(String? value) => value == null || value.trim().isEmpty ? 'هذا الحقل مطلوب' : null;
  Future<void> _submit() async {
    if (!_key.currentState!.validate() || _busy) return;
    setState(() => _busy = true);
    try { final card = await widget.repository.onboardCompany(name: _company.text.trim(), contact: _contact.text.trim(), phone: _phone.text.trim()); if (mounted) setState(() => _membership = card); }
    catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إنشاء الحساب'))); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('تسجيل شركة أو مؤسسة')), body: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680), child: Form(key: _key, child: ListView(padding: const EdgeInsets.all(24), children: [
    Text('تسجيل سريع', style: Theme.of(context).textTheme.headlineSmall), const SizedBox(height: 8), const Text('أدخل بيانات الشركة وجهة التواصل لإنشاء الحساب.'), const SizedBox(height: 24),
    TextFormField(controller: _company, validator: _required, decoration: const InputDecoration(labelText: 'اسم الشركة أو البنك', border: OutlineInputBorder())), const SizedBox(height: 16),
    TextFormField(controller: _contact, validator: _required, decoration: const InputDecoration(labelText: 'اسم جهة التواصل', border: OutlineInputBorder())), const SizedBox(height: 16),
    TextFormField(controller: _phone, validator: _required, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'رقم الهاتف', border: OutlineInputBorder())), const SizedBox(height: 20),
    FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'جارٍ إنشاء الحساب...' : 'إنشاء الحساب')),
    if (_membership != null) Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('بطاقة العضوية'), const Divider(), Text(_membership!.organization), Text('رقم العضوية: ${_membership!.membershipNumber}'), Text('اسم المستخدم: ${_membership!.username}')]))),
  ])))));
}
