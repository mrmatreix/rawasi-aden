import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireRole,SupervisorScopeGuard} from '../src/features/identity/application/scope-guard.ts';
const principal={userId:'user-1',role:'SUPERVISOR_VENDOR' as const,isActive:true};
const vendor={vendorId:'vendor-1',userId:'user-1',regionId:'aden',categoryId:'maintenance',status:'ACTIVE' as const,deletedAt:null,userActive:true,contractStartDate:new Date('2026-01-01'),contractEndDate:new Date('2028-01-01')};
const order={id:'order-1',regionId:'aden',serviceCategoryId:'maintenance',vendorId:'vendor-1',deletedAt:null};
const now=new Date('2026-11-14T20:00:00Z');
function make(v=vendor,o=order){return new SupervisorScopeGuard({async findVendorByUserId(){return v},async findOrderScope(){return o}})}
test('role and active identity are required',()=>{assert.doesNotThrow(()=>requireRole(principal,['SUPERVISOR_VENDOR']));assert.throws(()=>requireRole({...principal,isActive:false},['SUPERVISOR_VENDOR']));assert.throws(()=>requireRole(principal,['SUPER_ADMIN']))});
test('scope uses persisted vendor, assignment, category, region and inclusive contract dates',async()=>{
 assert.equal((await make().requireAssignedOrder(principal,'order-1',now)).vendor.vendorId,'vendor-1');
 await assert.rejects(make().requireAssignedOrder(principal,'other-order',now));
 await assert.rejects(make(vendor,{...order,regionId:'other'}).requireAssignedOrder(principal,'order-1',now));
 await assert.rejects(make(vendor,{...order,serviceCategoryId:'other'}).requireAssignedOrder(principal,'order-1',now));
 await assert.rejects(make(vendor,{...order,vendorId:'other'}).requireAssignedOrder(principal,'order-1',now));
 await assert.rejects(make({...vendor,userActive:false}).requireAssignedOrder(principal,'order-1',now));
 await assert.rejects(make({...vendor,contractEndDate:new Date('2026-01-01')}).requireAssignedOrder(principal,'order-1',now));
 await assert.doesNotReject(make().requireAssignedOrder(principal,'order-1',new Date('2028-01-01T20:59:00Z')));
});
