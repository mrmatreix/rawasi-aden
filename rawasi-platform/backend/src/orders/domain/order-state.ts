export type OrderState = 'SUBMITTED' | 'PRICED_BY_CONTRACTOR' | 'REJECTION_REQUESTED' | 'QUOTED_TO_CLIENT' | 'CLIENT_APPROVED' | 'CLIENT_REJECTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type Role = 'CLIENT' | 'CONTRACTOR' | 'SUPER_ADMIN' | 'FIELD_MARKETER';

export interface Order {
  id: string;
  clientId: string;
  contractorId: string | null;
  status: OrderState;
  slaDeadlineAt: string;
  description: string;
}
export interface Actor { userId: string; role: Role; contractorId?: string }

const transitions: ReadonlyArray<readonly [OrderState, OrderState, Role]> = [
  ['SUBMITTED','PRICED_BY_CONTRACTOR','CONTRACTOR'],
  ['SUBMITTED','REJECTION_REQUESTED','CONTRACTOR'],
  ['PRICED_BY_CONTRACTOR','QUOTED_TO_CLIENT','SUPER_ADMIN'],
  ['REJECTION_REQUESTED','SUBMITTED','SUPER_ADMIN'],
  ['REJECTION_REQUESTED','CANCELLED','SUPER_ADMIN'],
  ['QUOTED_TO_CLIENT','CLIENT_APPROVED','CLIENT'],
  ['QUOTED_TO_CLIENT','CLIENT_REJECTED','CLIENT'],
  ['CLIENT_APPROVED','IN_PROGRESS','SUPER_ADMIN'],
  ['IN_PROGRESS','COMPLETED','SUPER_ADMIN'],
];

export function slaDeadline(submittedAt: Date): string {
  if (Number.isNaN(submittedAt.getTime())) throw new Error('Invalid submission time');
  return new Date(submittedAt.getTime() + 10 * 60_000).toISOString();
}

// This pure decision must be persisted with its audit record in one database transaction.
export function decideTransition(order: Order, actor: Actor, next: OrderState, note?: string): {order: Order; audit: {actorUserId: string; from: OrderState; to: OrderState; note: string | null}} {
  if (!transitions.some(([from,to,role]) => from === order.status && to === next && role === actor.role)) throw new Error('Transition forbidden');
  if (actor.role === 'CLIENT' && actor.userId !== order.clientId) throw new Error('Order access forbidden');
  if (actor.role === 'CONTRACTOR' && (!actor.contractorId || actor.contractorId !== order.contractorId)) throw new Error('Order access forbidden');
  const normalized = note?.trim() || null;
  if (next === 'REJECTION_REQUESTED' && !normalized) throw new Error('Rejection justification required');
  if (order.status === 'REJECTION_REQUESTED' && next === 'SUBMITTED') throw new Error('Reassignment must use a transaction with a new contractor');
  return {order: {...order,status:next}, audit:{actorUserId:actor.userId,from:order.status,to:next,note:normalized}};
}
