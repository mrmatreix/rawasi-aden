import { DomainException } from '../../orders/domain/domain-exception.ts';
import type {Role} from '../../orders/domain/order-state-machine.ts';

export interface AuthenticatedPrincipal { userId: string; role: Role; isActive: boolean }
export interface VendorScopeRecord { vendorId:string; userId:string; regionId:string; categoryId:string; status:'ACTIVE'|'SUSPENDED'|'EXPIRED'; deletedAt:Date|null; userActive:boolean; contractStartDate:Date; contractEndDate:Date }
export interface OrderScopeRecord { id:string; regionId:string; serviceCategoryId:string; vendorId:string|null; deletedAt:Date|null }
export interface ScopeRepository { findVendorByUserId(userId:string):Promise<VendorScopeRecord|null>; findOrderScope(orderId:string):Promise<OrderScopeRecord|null> }

/** Principal must originate from verified authentication, never from request JSON. */
export function requireRole(principal:AuthenticatedPrincipal, roles:readonly Role[]):void {
  if (!principal?.isActive || !principal.userId?.trim() || !roles.includes(principal.role)) throw new DomainException('ACCESS_DENIED','ليس لديك صلاحية تنفيذ العملية');
}

export class SupervisorScopeGuard {
  private readonly repository: ScopeRepository;
  constructor(repository: ScopeRepository) { this.repository = repository; }
  async requireAssignedOrder(principal:AuthenticatedPrincipal, orderId:string, now:Date):Promise<{vendor:VendorScopeRecord;order:OrderScopeRecord}> {
    requireRole(principal,['SUPERVISOR_VENDOR']);
    if (!orderId?.trim() || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new DomainException('INVALID_INPUT','بيانات الطلب غير صالحة');
    const [vendor,order]=await Promise.all([this.repository.findVendorByUserId(principal.userId),this.repository.findOrderScope(orderId)]);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    if (!vendor || !order || !vendor.userActive || vendor.userId !== principal.userId || order.id !== orderId || vendor.status !== 'ACTIVE' || vendor.deletedAt || order.deletedAt || !Number.isFinite(vendor.contractStartDate.getTime()) || !Number.isFinite(vendor.contractEndDate.getTime()) || today < vendor.contractStartDate.toISOString().slice(0,10) || today > vendor.contractEndDate.toISOString().slice(0,10) || vendor.vendorId !== order.vendorId || vendor.regionId !== order.regionId || vendor.categoryId !== order.serviceCategoryId) {
      throw new DomainException('ACCESS_DENIED','الطلب غير متاح لهذا المستخدم');
    }
    return {vendor,order};
  }
}
