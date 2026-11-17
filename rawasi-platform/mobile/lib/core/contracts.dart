enum UserRole { superAdmin, supervisorVendor, client, fieldPromoter }

class Session {
  const Session({required this.userId, required this.displayName, required this.role});
  final String userId;
  final String displayName;
  final UserRole role;
}

class Region {
  const Region(this.id, this.name);
  final String id;
  final String name;
}

class ServiceOption {
  const ServiceOption({required this.id, required this.name, required this.hideInitialPrice, required this.allowClientBudget});
  final String id;
  final String name;
  final bool hideInitialPrice;
  final bool allowClientBudget;
}

class Worker {
  const Worker(this.id, this.name);
  final String id;
  final String name;
}

class OrderSummary {
  const OrderSummary({required this.id, required this.number, required this.status, required this.description, this.slaDeadline, this.adminRejectionReason});
  final String id;
  final String number;
  final String status;
  final String description;
  final DateTime? slaDeadline;
  /// Returned only by an authenticated administrator endpoint.
  final String? adminRejectionReason;
}

class PriceLine {
  const PriceLine({required this.label, required this.amount, this.note});
  final String label;
  final String amount;
  final String? note;
}

class ClientQuote {
  const ClientQuote({required this.currency, required this.lines, required this.total});
  final String currency;
  final List<PriceLine> lines;
  final String total;
}

class AdminQuote {
  const AdminQuote({required this.currency, required this.baseCost, required this.extraCosts, required this.markupPercent, required this.profit, required this.clientQuote});
  final String currency;
  final String baseCost;
  final List<PriceLine> extraCosts;
  final String markupPercent;
  final String profit;
  final ClientQuote clientQuote;
}

class SupervisorRate {
  const SupervisorRate({required this.agreedBaseCost, required this.maximumBaseCost, required this.currency});
  final String agreedBaseCost;
  final String maximumBaseCost;
  final String currency;
}

class CostInput {
  const CostInput({required this.description, required this.amount, required this.reason});
  final String description;
  final String amount;
  final String reason;
}

class IssuedMembership {
  const IssuedMembership({required this.organization, required this.membershipNumber, required this.username});
  final String organization;
  final String membershipNumber;
  final String username;
}

/// The backend adapter must authenticate requests and enforce role and resource access.
abstract interface class RawasiRepository {
  Stream<Session?> sessionChanges();
  Future<void> signIn(String username, String password);
  Future<void> signOut();
  Future<List<Region>> regions();
  Future<List<ServiceOption>> services(String regionId);
  Future<void> createOrder({required String regionId, required String serviceId, required String description});
  Future<List<OrderSummary>> orders();
  Future<ClientQuote?> clientQuote(String orderId);
  Future<AdminQuote?> adminQuote(String orderId);
  Future<void> respondToQuote(String orderId, {required bool accept, required String note});
  Future<List<Worker>> workers();
  Future<SupervisorRate> supervisorRate(String orderId);
  Future<void> submitSupervisorQuote(String orderId, {required String workerId, required String baseCost, required String baseReason, required List<CostInput> extraCosts});
  Future<void> requestRejection(String orderId, String reason);
  Future<void> approveQuote(String orderId);
  Future<void> resolveRejection(String orderId, {required bool returnToReview});
  Future<IssuedMembership> onboardCompany({required String name, required String contact, required String phone});
}

class BackendUnavailable implements Exception {
  const BackendUnavailable();
  @override
  String toString() => 'الخدمة غير متاحة حاليًا. تعذر الاتصال بالخادم.';
}
