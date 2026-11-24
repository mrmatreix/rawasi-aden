import 'package:flutter/material.dart';
import '../../../core/contracts.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.repository});
  final RawasiRepository repository;
  @override State<LoginScreen> createState() => _LoginScreenState();
}
class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _key = GlobalKey<FormState>();
  bool _busy = false;
  String? _error;
  @override void dispose() { _username.dispose(); _password.dispose(); super.dispose(); }
  Future<void> _submit() async {
    if (!_key.currentState!.validate() || _busy) return;
    setState(() { _busy = true; _error = null; });
    try { await widget.repository.signIn(_username.text.trim(), _password.text); }
    catch (_) { if (mounted) setState(() => _error = 'تعذر تسجيل الدخول. تحقق من الاتصال وبيانات الحساب.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(body: SafeArea(child: Center(child: SingleChildScrollView(child: ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 440), child: Padding(padding: const EdgeInsets.all(24), child: Form(key: _key, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Icon(Icons.apartment_rounded, size: 64, color: Theme.of(context).colorScheme.primary),
      const SizedBox(height: 12), Text('رواسي', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: 8), const Text('سجّل الدخول للمتابعة', textAlign: TextAlign.center), const SizedBox(height: 24),
      TextFormField(controller: _username, decoration: const InputDecoration(labelText: 'اسم المستخدم', border: OutlineInputBorder()), validator: (v) => v == null || v.trim().isEmpty ? 'أدخل اسم المستخدم' : null),
      const SizedBox(height: 16), TextFormField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'كلمة المرور', border: OutlineInputBorder()), validator: (v) => v == null || v.isEmpty ? 'أدخل كلمة المرور' : null),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      const SizedBox(height: 20), FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'جارٍ التحقق...' : 'تسجيل الدخول')),
    ]))))))));
}
