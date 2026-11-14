// Money is stored as integer minor units. Margin is specified in basis points.
export interface PricingInput {
  baseMinor: bigint;
  extraMinor: bigint;
  ceilingMinor: bigint;
  marginBasisPoints: bigint;
  extraReason?: string;
}

export interface OrderPricing {
  internalBaseMinor: bigint;
  internalExtraMinor: bigint;
  extraReason: string | null;
  marginBasisPoints: bigint;
  clientBaseMinor: bigint;
  clientExtraMinor: bigint;
  totalClientMinor: bigint;
}

export function calculatePricing(input: PricingInput): OrderPricing {
  const { baseMinor, extraMinor, ceilingMinor, marginBasisPoints } = input;
  if ([baseMinor, extraMinor, ceilingMinor, marginBasisPoints].some(v => typeof v !== 'bigint' || v < 0n)) throw new Error('Invalid monetary input');
  if (baseMinor > ceilingMinor) throw new Error('Base cost exceeds agreed ceiling');
  if (marginBasisPoints > 10000n) throw new Error('Margin exceeds permitted range');
  const extraReason = input.extraReason?.trim() || null;
  if (extraMinor > 0n && !extraReason) throw new Error('Extra cost requires a reason');
  // Round each client-facing line to the nearest minor unit, half upward.
  const sellingPrice = (amount: bigint) => (amount * (10000n + marginBasisPoints) + 5000n) / 10000n;
  const clientBaseMinor = sellingPrice(baseMinor), clientExtraMinor = sellingPrice(extraMinor);
  return {internalBaseMinor: baseMinor, internalExtraMinor: extraMinor, extraReason, marginBasisPoints, clientBaseMinor, clientExtraMinor, totalClientMinor: clientBaseMinor + clientExtraMinor};
}
