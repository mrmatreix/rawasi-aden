'use strict';
// Money in integer fils (1/100 of the currency unit). Convert once at the boundary.
function toFils(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw Object.assign(new Error('مبلغ غير صالح'), { statusCode: 400 });
  // Round half away from zero on the decimal string to avoid binary drift (1.005 -> 101).
  const sign = n < 0 ? -1 : 1;
  const [int, frac = ''] = Math.abs(n).toFixed(6).split('.');
  const fils = Number(int) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return sign * fils;
}
function fromFils(fils) { return Number(fils) / 100; }
function round2(value) { return fromFils(toFils(value)); }
module.exports = { toFils, fromFils, round2 };
