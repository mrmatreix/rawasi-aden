import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rawasi_mobile/app/role_router.dart';
import 'package:rawasi_mobile/core/contracts.dart';
import 'package:rawasi_mobile/features/identity/presentation/login_screen.dart';
import 'package:rawasi_mobile/features/identity/presentation/promoter_screen.dart';
import 'package:rawasi_mobile/features/orders/presentation/client_screens.dart';
import 'package:rawasi_mobile/features/orders/presentation/staff_screens.dart';

class FakeRepository implements RawasiRepository {
  FakeRepository(this.session);
  final Session? session;
  @override Stream<Session?> sessionChanges() => Stream.value(session);
  @override Future<List<Region>> regions() async => [];
  @override Future<List<OrderSummary>> orders() async => [];
  @override dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
class ChangingRepository extends FakeRepository {
  ChangingRepository() : super(null);
  final controller = StreamController<Session?>();
  @override Stream<Session?> sessionChanges() => controller.stream;
  @override Future<List<OrderSummary>> orders() async => [const OrderSummary(id: 'o', number: 'ORDER-1', status: 'SUBMITTED', description: 'test')];
  @override Future<ClientQuote?> clientQuote(String orderId) async => null;
}
void main() {
  for (final role in UserRole.values) {
    testWidgets('session role $role selects only its shell', (tester) async {
      await tester.pumpWidget(MaterialApp(home: RoleBasedAppRouter(repository: FakeRepository(Session(userId: '1', displayName: 'Test', role: role)))));
      await tester.pumpAndSettle();
      expect(find.byType(ClientPortalShell), findsNWidgets(role == UserRole.client ? 1 : 0));
      expect(find.byType(SupervisorWorkspaceShell), findsNWidgets(role == UserRole.supervisorVendor ? 1 : 0));
      expect(find.byType(AdminDashboardShell), findsNWidgets(role == UserRole.superAdmin ? 1 : 0));
      expect(find.byType(PromoterTabletOnboardingScreen), findsNWidgets(role == UserRole.fieldPromoter ? 1 : 0));
    });
  }
  testWidgets('no session opens login', (tester) async {
    await tester.pumpWidget(MaterialApp(home: RoleBasedAppRouter(repository: FakeRepository(null))));
    await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsOneWidget);
  });
  testWidgets('sign-out discards nested client detail routes', (tester) async {
    final repo = ChangingRepository();
    await tester.pumpWidget(MaterialApp(home: RoleBasedAppRouter(repository: repo)));
    repo.controller.add(const Session(userId: '1', displayName: 'Test', role: UserRole.client));
    await tester.pumpAndSettle();
    await tester.tap(find.text('طلباتي')); await tester.pumpAndSettle();
    await tester.tap(find.text('ORDER-1')); await tester.pumpAndSettle();
    expect(find.byType(ClientQuoteScreen), findsOneWidget);
    repo.controller.add(null); await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.byType(ClientQuoteScreen), findsNothing);
    await repo.controller.close();
  });
}
