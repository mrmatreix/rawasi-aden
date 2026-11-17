import { DomainException, requireText } from './domain-exception.ts';

/** Decimal input is a string. Amounts use two fractional digits; markup is a percentage, e.g. 30 or 30.25. */
export interface AdditionalCostInput { id: string; description: string; clientDescription: string; vendorCost: string; reason: string; clientNote?: string }
export interface PricingInput {
  currency: string;
  agreedBaseCost: string;
  maxBaseCost: string;
  vendorBaseCost: string;
  baseAdjustmentReason?: string;
  additionalCosts: readonly AdditionalCostInput[];
  rawasiMarkupPercent: string;
}
export interface PricedItem { id: string; description: string; clientDescription: string; vendorCostMinor: bigint; clientPriceMinor: bigint; reason: string; clientNote: string | null }
export interface PricingResult {
  currency: string;
  vendorBaseCostMinor: bigint;
  baseAdjustmentReason: string | null;
  markupBasisPoints: bigint;
  clientBasePriceMinor: bigint;
  additionalItems: readonly PricedItem[];
  vendorTotalMinor: bigint;
  clientTotalMinor: bigint;
  profitMinor: bigint;
}
const MAX_MINOR = 999999999999999999n; // PostgreSQL numeric(18,2)
function parseAmount(input: string, field: string): bigint {
  if (typeof input !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(input)) throw new DomainException('INVALID_AMOUNT', `${field}: مبلغ غير صالح`);
  const [whole, decimal = ''] = input.split('.');
  const value = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  if (value > MAX_MINOR) throw new DomainException('INVALID_AMOUNT', `${field}: المبلغ يتجاوز الحد المسموح`);
  return value;
}
function checked(value: bigint): bigint {
  if (value > MAX_MINOR) throw new DomainException('INVALID_AMOUNT', 'الإجمالي يتجاوز الحد المسموح');
  return value;
}
export function formatMinor(value: bigint): string {
  if (value < 0n || value > MAX_MINOR) throw new DomainException('INVALID_AMOUNT', 'مبلغ غير صالح');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
export class PricingEngineDomainService {
  calculate(input: PricingInput): PricingResult {
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new DomainException('INVALID_INPUT', 'رمز العملة غير صالح');
    const agreed = parseAmount(input.agreedBaseCost, 'التكلفة المتفق عليها');
    const ceiling = parseAmount(input.maxBaseCost, 'سقف التكلفة');
    const base = parseAmount(input.vendorBaseCost, 'التكلفة الأساسية');
    if (agreed > ceiling || base > ceiling) throw new DomainException('COST_CEILING_EXCEEDED', 'التكلفة الأساسية تتجاوز السقف المتفق عليه');
    const adjustment = base !== agreed ? requireText(input.baseAdjustmentReason, 'سبب تعديل التكلفة الأساسية') : null;
    const markup = parseAmount(input.rawasiMarkupPercent, 'نسبة الربح');
    if (markup > 10000n) throw new DomainException('INVALID_MARKUP', 'نسبة الربح يجب أن تكون بين صفر و100%');
    const price = (amount: bigint) => checked((amount * (10000n + markup) + 5000n) / 10000n);
    const seen = new Set<string>();
    const additionalItems = input.additionalCosts.map(item => {
      const id = requireText(item.id, 'معرّف البند');
      if (seen.has(id)) throw new DomainException('INVALID_INPUT', 'معرّف التكلفة الإضافية مكرر');
      seen.add(id);
      const vendorCostMinor = parseAmount(item.vendorCost, 'التكلفة الإضافية');
      const description = requireText(item.description, 'وصف البند');
      const reason = requireText(item.reason, 'سبب التكلفة الإضافية');
      const clientDescription = requireText(item.clientDescription, 'الوصف المخصص للعميل');
      return {id, description, clientDescription, vendorCostMinor, clientPriceMinor: price(vendorCostMinor), reason, clientNote: item.clientNote?.trim() || null};
    });
    const clientBasePriceMinor = price(base);
    const vendorTotalMinor = checked(additionalItems.reduce((sum, item) => sum + item.vendorCostMinor, base));
    const clientTotalMinor = checked(additionalItems.reduce((sum, item) => sum + item.clientPriceMinor, clientBasePriceMinor));
    return {currency: input.currency, vendorBaseCostMinor: base, baseAdjustmentReason: adjustment, markupBasisPoints: markup, clientBasePriceMinor, additionalItems, vendorTotalMinor, clientTotalMinor, profitMinor: clientTotalMinor - vendorTotalMinor};
  }
}
export type ServiceDepartment = 'DESIGN' | 'MAINTENANCE' | 'ENGINEERING' | 'SUPERVISION' | 'CONSTRUCTION';
/** Budget option is effective only if both the service and the feature flag allow it. */
export function shouldHidePriceOnSubmission(department: ServiceDepartment, allowClientBudget: boolean, budgetFeatureEnabled: boolean): boolean {
  if (!['DESIGN','MAINTENANCE','ENGINEERING','SUPERVISION','CONSTRUCTION'].includes(department)) throw new DomainException('INVALID_INPUT', 'قسم الخدمة غير صالح');
  return department !== 'DESIGN' && !(allowClientBudget && budgetFeatureEnabled);
}
