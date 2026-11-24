import '../core/contracts.dart';

/// Fail-closed adapter until the authenticated backend endpoints are available.
class UnavailableRepository implements RawasiRepository {
  const UnavailableRepository();
  Never _unavailable() => throw const BackendUnavailable();
  @override Stream<Session?> sessionChanges() => Stream.value(null);
  @override Future<void> signIn(String username, String password) async => _unavailable();
  @override Future<void> signOut() async => _unavailable();
  @override Future<List<Region>> regions() async => _unavailable();
  @override Future<List<ServiceOption>> services(String regionId) async => _unavailable();
  @override Future<void> createOrder({required String regionId, required String serviceId, required String description}) async => _unavailable();
  @override Future<List<OrderSummary>> orders() async => _unavailable();
  @override Future<ClientQuote?> clientQuote(String orderId) async => _unavailable();
  @override Future<AdminQuote?> adminQuote(String orderId) async => _unavailable();
  @override Future<void> respondToQuote(String orderId, {required bool accept, required String note}) async => _unavailable();
  @override Future<List<Worker>> workers() async => _unavailable();
  @override Future<SupervisorRate> supervisorRate(String orderId) async => _unavailable();
  @override Future<void> submitSupervisorQuote(String orderId, {required String workerId, required String baseCost, required String baseReason, required List<CostInput> extraCosts}) async => _unavailable();
  @override Future<void> requestRejection(String orderId, String reason) async => _unavailable();
  @override Future<void> approveQuote(String orderId) async => _unavailable();
  @override Future<void> resolveRejection(String orderId, {required bool returnToReview}) async => _unavailable();
  @override Future<IssuedMembership> onboardCompany({required String name, required String contact, required String phone}) async => _unavailable();
}
