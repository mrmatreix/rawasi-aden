import type { Actor, Order } from '../domain/order-state.ts';
import type { OrderPricing } from '../domain/pricing.ts';

// Explicit allowlists: do not spread internal objects into responses.
export function serializeOrder(order: Order, actor: Actor, pricing: OrderPricing | null) {
  if (actor.role === 'FIELD_MARKETER') throw new Error('Order access forbidden');
  if (actor.role === 'CLIENT' && actor.userId !== order.clientId) throw new Error('Order access forbidden');
  if (actor.role === 'CONTRACTOR' && (!actor.contractorId || actor.contractorId !== order.contractorId)) throw new Error('Order access forbidden');
  if (!['CLIENT','CONTRACTOR','SUPER_ADMIN'].includes(actor.role)) throw new Error('Order access forbidden');
  const common = {id:order.id,status:order.status,description:order.description};
  if (actor.role === 'CLIENT') {
    const visible = ['QUOTED_TO_CLIENT','CLIENT_APPROVED','CLIENT_REJECTED','IN_PROGRESS','COMPLETED'].includes(order.status);
    return {...common, pricing: pricing && visible ? {clientBaseMinor:pricing.clientBaseMinor.toString(),clientExtraMinor:pricing.clientExtraMinor.toString(),totalClientMinor:pricing.totalClientMinor.toString()} : null};
  }
  if (actor.role === 'CONTRACTOR') return {...common,pricing:pricing ? {internalBaseMinor:pricing.internalBaseMinor.toString(),internalExtraMinor:pricing.internalExtraMinor.toString(),extraReason:pricing.extraReason} : null};
  return {...common,clientId:order.clientId,contractorId:order.contractorId,slaDeadlineAt:order.slaDeadlineAt,pricing:pricing ? {...pricing,internalBaseMinor:pricing.internalBaseMinor.toString(),internalExtraMinor:pricing.internalExtraMinor.toString(),marginBasisPoints:pricing.marginBasisPoints.toString(),clientBaseMinor:pricing.clientBaseMinor.toString(),clientExtraMinor:pricing.clientExtraMinor.toString(),totalClientMinor:pricing.totalClientMinor.toString()} : null};
}
