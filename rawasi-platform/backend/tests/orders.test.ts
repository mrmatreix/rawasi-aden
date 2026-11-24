import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculatePricing} from '../src/orders/domain/pricing.ts';
import {decideTransition, slaDeadline} from '../src/orders/domain/order-state.ts';
import type {Order} from '../src/orders/domain/order-state.ts';
import {serializeOrder} from '../src/orders/application/serialize-order.ts';

const priced = calculatePricing({baseMinor:700000n,extraMinor:400000n,ceilingMinor:700000n,marginBasisPoints:3000n,extraReason:'transport'});
const order: Order = {id:'order-1',clientId:'client-1',contractorId:'contractor-1',status:'QUOTED_TO_CLIENT',slaDeadlineAt:'2026-01-01T00:10:00.000Z',description:'service'};
test('prices use integer arithmetic, independent line rounding and validate ceilings', () => {
  assert.equal(priced.clientBaseMinor,910000n); assert.equal(priced.clientExtraMinor,520000n); assert.equal(priced.totalClientMinor,1430000n);
  assert.equal(calculatePricing({baseMinor:1n,extraMinor:0n,ceilingMinor:1n,marginBasisPoints:5000n}).totalClientMinor,2n);
  assert.throws(()=>calculatePricing({baseMinor:2n,extraMinor:0n,ceilingMinor:1n,marginBasisPoints:0n}));
  assert.throws(()=>calculatePricing({baseMinor:1n,extraMinor:1n,ceilingMinor:1n,marginBasisPoints:0n,extraReason:' '}));
});
test('role allowlists never expose internal cost to clients or sales to contractors', () => {
  const client = JSON.stringify(serializeOrder(order,{userId:'client-1',role:'CLIENT'},priced));
  assert.match(client,/totalClientMinor/); assert.doesNotMatch(client,/internal|margin|extraReason/);
  const contractor = JSON.stringify(serializeOrder(order,{userId:'worker',role:'CONTRACTOR',contractorId:'contractor-1'},priced));
  assert.match(contractor,/internalBaseMinor/); assert.doesNotMatch(contractor,/clientBase|totalClient|margin/);
  assert.equal(serializeOrder({...order,status:'PRICED_BY_CONTRACTOR'},{userId:'client-1',role:'CLIENT'},priced).pricing,null);
  assert.throws(()=>serializeOrder(order,{userId:'other',role:'CLIENT'},priced));
  assert.throws(()=>serializeOrder(order,{userId:'worker',role:'CONTRACTOR',contractorId:'other'},priced));
  assert.throws(()=>serializeOrder(order,{userId:'marketer',role:'FIELD_MARKETER'},priced));
});
test('transitions enforce actor, assignment, justification and ten-minute deadline', () => {
  assert.equal(slaDeadline(new Date('2026-01-01T00:00:00Z')),'2026-01-01T00:10:00.000Z');
  assert.equal(decideTransition(order,{userId:'client-1',role:'CLIENT'},'CLIENT_APPROVED').audit.from,'QUOTED_TO_CLIENT');
  assert.throws(()=>decideTransition(order,{userId:'other',role:'CLIENT'},'CLIENT_APPROVED'));
  const submitted: Order = {...order,status:'SUBMITTED'};
  assert.throws(()=>decideTransition(submitted,{userId:'worker',role:'CONTRACTOR',contractorId:'contractor-1'},'REJECTION_REQUESTED',' '));
  assert.throws(()=>decideTransition(submitted,{userId:'worker',role:'CONTRACTOR',contractorId:'wrong'},'PRICED_BY_CONTRACTOR'));
  assert.throws(()=>decideTransition({...order,status:'REJECTION_REQUESTED'},{userId:'admin',role:'SUPER_ADMIN'},'SUBMITTED'));
});
