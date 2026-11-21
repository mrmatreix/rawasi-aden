import { DomainException } from './domain-exception.ts';
import { formatMinor } from './pricing-engine.ts';
import type { Actor, DomainOrder } from './order-state-machine.ts';

function requireAccess(order: DomainOrder, actor: Actor, role: Actor['role']): void {
  if (!actor.userId?.trim() || actor.role !== role) throw new DomainException('ACCESS_DENIED', 'لا تملك صلاحية عرض الطلب');
  if (role === 'CLIENT' && actor.userId !== order.clientId) throw new DomainException('ACCESS_DENIED', 'الطلب لا يخص العميل');
  if (role === 'SUPERVISOR_VENDOR' && (!actor.vendorId || actor.vendorId !== order.vendorId)) throw new DomainException('ACCESS_DENIED', 'الطلب لا يخص المنفذ');
}
export function toAdminOrderDTO(order: DomainOrder, actor: Actor) {
  requireAccess(order, actor, 'SUPER_ADMIN');
  const p = order.pricing;
  return {id:order.id,status:order.status,clientId:order.clientId,vendorId:order.vendorId,workerId:order.workerId,rejectionReason:order.rejectionReason,pricing:p ? {
    currency:p.currency,vendorBaseCost:formatMinor(p.vendorBaseCostMinor),baseAdjustmentReason:p.baseAdjustmentReason,
    additionalItems:p.additionalItems.map(i=>({id:i.id,description:i.description,vendorCost:formatMinor(i.vendorCostMinor),clientPrice:formatMinor(i.clientPriceMinor),reason:i.reason})),
    markupPercent:formatMinor(p.markupBasisPoints),profit:formatMinor(p.profitMinor),vendorTotal:formatMinor(p.vendorTotalMinor),clientBasePrice:formatMinor(p.clientBasePriceMinor),clientTotal:formatMinor(p.clientTotalMinor)
  }:null};
}
export function toSupervisorOrderDTO(order: DomainOrder, actor: Actor) {
  requireAccess(order, actor, 'SUPERVISOR_VENDOR');
  const p=order.pricing;
  return {id:order.id,status:order.status,workerId:order.workerId,pricing:p ? {currency:p.currency,vendorBaseCost:formatMinor(p.vendorBaseCostMinor),baseAdjustmentReason:p.baseAdjustmentReason,additionalItems:p.additionalItems.map(i=>({id:i.id,description:i.description,vendorCost:formatMinor(i.vendorCostMinor),reason:i.reason})),vendorTotal:formatMinor(p.vendorTotalMinor)} : null};
}
export function toClientOrderDTO(order: DomainOrder, actor: Actor) {
  requireAccess(order, actor, 'CLIENT');
  const visible = ['QUOTED_TO_CLIENT','CLIENT_APPROVED','CLIENT_REJECTED','IN_PROGRESS','COMPLETED'].includes(order.status);
  const p=visible ? order.pricing : null;
  return {id:order.id,status:order.status,pricing:p ? {currency:p.currency,clientBasePrice:formatMinor(p.clientBasePriceMinor),additionalItems:p.additionalItems.map(i=>({id:i.id,description:i.clientDescription,clientPrice:formatMinor(i.clientPriceMinor),note:i.clientNote})),clientTotal:formatMinor(p.clientTotalMinor)} : null};
}
