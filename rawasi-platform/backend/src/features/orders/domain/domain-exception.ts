export type DomainErrorCode = 'INVALID_AMOUNT' | 'INVALID_MARKUP' | 'COST_CEILING_EXCEEDED' | 'REASON_REQUIRED' | 'INVALID_STATE_TRANSITION' | 'ACCESS_DENIED' | 'INVALID_INPUT' | 'INCONSISTENT_ORDER';
export class DomainException extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainException';
    this.code = code;
  }
}
export function requireText(value: string | undefined | null, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new DomainException('REASON_REQUIRED', `${field} مطلوب`);
  return value.trim();
}
