import 'package:flutter/material.dart';
import '../core/contracts.dart';
import '../features/identity/presentation/login_screen.dart';
import '../features/identity/presentation/promoter_screen.dart';
import '../features/orders/presentation/client_screens.dart';
import '../features/orders/presentation/staff_screens.dart';

class RoleBasedAppRouter extends StatefulWidget {
  const RoleBasedAppRouter({super.key, required this.repository});
  final RawasiRepository repository;
  @override State<RoleBasedAppRouter> createState() => _RoleBasedAppRouterState();
}
class _RoleBasedAppRouterState extends State<RoleBasedAppRouter> {
  late final Stream<Session?> _session = widget.repository.sessionChanges();
  @override Widget build(BuildContext context) => StreamBuilder<Session?>(
    stream: _session,
    builder: (context, snapshot) {
      if (snapshot.hasError) return const Scaffold(body: Center(child: Text('تعذر التحقق من الجلسة')));
      if (snapshot.connectionState == ConnectionState.waiting) return const Scaffold(body: Center(child: CircularProgressIndicator()));
      final session = snapshot.data;
      if (session == null) return LoginScreen(repository: widget.repository);
      // Routes belong to the authenticated session and are discarded on sign-out or role change.
      return Navigator(
        key: ValueKey('${session.userId}:${session.role.name}'),
        onGenerateRoute: (_) => MaterialPageRoute<void>(builder: (_) => switch (session.role) {
          UserRole.client => ClientPortalShell(session: session, repository: widget.repository),
          UserRole.supervisorVendor => SupervisorWorkspaceShell(session: session, repository: widget.repository),
          UserRole.superAdmin => AdminDashboardShell(session: session, repository: widget.repository),
          UserRole.fieldPromoter => PromoterTabletOnboardingScreen(session: session, repository: widget.repository),
        }),
      );
    },
  );
}
