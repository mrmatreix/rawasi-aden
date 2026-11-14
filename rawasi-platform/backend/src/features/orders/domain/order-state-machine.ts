import { DomainException, requireText } from './domain-exception.ts';
import type { PricingResult } from './pricing-engine.ts';

export type OrderStatus = 'SUBMITTED' | 'SUPERVISOR_REVIEW' | 'REJECTION_REQUESTED' | 'PENDING_ADMIN_APPROVAL' | 'REJECTED_BY_ADMIN' | 'QUOTED_TO_CLIENT' | 'CLIENT_APPROVED' | 'CLIENT_REJECTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type Role = 'SUPER_ADMIN' | 'SUPERVISOR_VENDOR' | 'CLIENT' | 'FIELD_PROMOTER';
export interface Actor { userId: string; role: Role; vendorId?: string }
export interface DomainOrder {
  id: string; clientId: string; vendorId: string | null; workerId: string | null;
  status: OrderStatus; submittedAt: string; slaDeadlineAt: string; pricing: PricingResult | null;
  rejectionReason: string | null; clientResponseNote: string | null; rating: number | null;
}
export interface TransitionContext { note?: string; workerId?: string; workerVendorId?: string; workerActive?: boolean; pricing?: PricingResult; rating?: number }
export interface TransitionAudit { actorId: string; from: OrderStatus; to: OrderStatus; internalNote: string | null }
export interface TransitionDecision { order: DomainOrder; audit: TransitionAudit; quarterlyRatingInput: number | null }
const transitions: ReadonlyArray<readonly [OrderStatus, OrderStatus, Role]> = [
  ['SUBMITTED','SUPERVISOR_REVIEW','SUPER_ADMIN'],
  ['SUPERVISOR_REVIEW','PENDING_ADMIN_APPROVAL','SUPERVISOR_VENDOR'],
  ['SUPERVISOR_REVIEW','REJECTION_REQUESTED','SUPERVISOR_VENDOR'],
  ['REJECTION_REQUESTED','SUPERVISOR_REVIEW','SUPER_ADMIN'],
  ['REJECTION_REQUESTED','REJECTED_BY_ADMIN','SUPER_ADMIN'],
  ['PENDING_ADMIN_APPROVAL','QUOTED_TO_CLIENT','SUPER_ADMIN'],
  ['QUOTED_TO_CLIENT','CLIENT_APPROVED','CLIENT'],
  ['QUOTED_TO_CLIENT','CLIENT_REJECTED','CLIENT'],
  ['CLIENT_APPROVED','IN_PROGRESS','SUPER_ADMIN'],
  ['IN_PROGRESS','COMPLETED','SUPER_ADMIN'],
];
export class SlaTracker {
  static deadline(submittedAt: Date): Date {
    if (!(submittedAt instanceof Date) || !Number.isFinite(submittedAt.getTime())) throw new DomainException('INVALID_INPUT', 'تاريخ الطلب غير صالح');
    return new Date(submittedAt.getTime() + 600_000);
  }
  static isOverdue(deadline: Date, now: Date, quotedAt: Date | null): boolean {
    if (!Number.isFinite(deadline.getTime()) || !Number.isFinite(now.getTime()) || (quotedAt !== null && !Number.isFinite(quotedAt.getTime()))) throw new DomainException('INVALID_INPUT', 'تاريخ SLA غير صالح');
    return quotedAt ? quotedAt.getTime() > deadline.getTime() : now.getTime() > deadline.getTime();
  }
}
export class OrderStateMachine {
  transition(order: DomainOrder, actor: Actor, next: OrderStatus, context: TransitionContext = {}): TransitionDecision {
    if (!actor.userId?.trim()) throw new DomainException('ACCESS_DENIED', 'هوية المستخدم مطلوبة');
    if (!transitions.some(([from,to,role]) => order.status === from && next === to && actor.role === role)) throw new DomainException('INVALID_STATE_TRANSITION', 'انتقال الحالة غير مسموح');
    if (actor.role === 'CLIENT' && actor.userId !== order.clientId) throw new DomainException('ACCESS_DENIED', 'الطلب لا يخص العميل');
    if (actor.role === 'SUPERVISOR_VENDOR' && (!actor.vendorId || actor.vendorId !== order.vendorId)) throw new DomainException('ACCESS_DENIED', 'الطلب غير مسند لهذا المنفذ');
    const updated: DomainOrder = {...order, status: next};
    let internalNote: string | null = null;
    let quarterlyRatingInput: number | null = null;
    if (next === 'SUPERVISOR_REVIEW' && !order.vendorId) throw new DomainException('INCONSISTENT_ORDER', 'يجب إسناد الطلب إلى منفذ');
    if (next === 'REJECTION_REQUESTED') {
      internalNote = requireText(context.note, 'سبب طلب الرفض');
      updated.rejectionReason = internalNote;
    }
    if (next === 'PENDING_ADMIN_APPROVAL') {
      if (!context.workerId || !context.workerActive || context.workerVendorId !== order.vendorId) throw new DomainException('INVALID_INPUT', 'اختر عاملًا نشطًا تابعًا للمنفذ المسند');
      if (!context.pricing) throw new DomainException('INVALID_INPUT', 'التسعير مطلوب قبل اعتماد الإدارة');
      updated.workerId = context.workerId; updated.pricing = context.pricing;
    }
    if (next === 'QUOTED_TO_CLIENT' && (!order.pricing || !order.workerId)) throw new DomainException('INCONSISTENT_ORDER', 'العامل والتسعير مطلوبان قبل إرسال العرض');
    if (next === 'CLIENT_APPROVED' || next === 'CLIENT_REJECTED') updated.clientResponseNote = requireText(context.note, 'ملاحظة العميل');
    if (next === 'COMPLETED') {
      if (!Number.isInteger(context.rating) || (context.rating as number) < 1 || (context.rating as number) > 5) throw new DomainException('INVALID_INPUT', 'التقييم يجب أن يكون من 1 إلى 5');
      quarterlyRatingInput = context.rating as number; updated.rating = quarterlyRatingInput;
    }
    return {order: updated, audit: {actorId: actor.userId, from: order.status, to: next, internalNote}, quarterlyRatingInput};
  }
}
/** Recompute from stored completed ratings within the selected vendor and quarter. */
export function calculateQuarterlyRating(ratings: readonly number[]): {sampleCount: number; averageHundredths: number; belowThreshold: boolean} {
  if (!ratings.length || ratings.some(r => !Number.isInteger(r) || r < 1 || r > 5)) throw new DomainException('INVALID_INPUT', 'التقييمات يجب أن تكون أعدادًا صحيحة من 1 إلى 5');
  const sum = ratings.reduce((a,b)=>a+b,0);
  const averageHundredths = Math.floor((sum * 100 + ratings.length / 2) / ratings.length);
  return {sampleCount:ratings.length, averageHundredths, belowThreshold:sum < ratings.length * 4};
}
