import {DomainException,requireText} from '../../orders/domain/domain-exception.ts';
import {requireRole} from '../../identity/application/scope-guard.ts';
import type {AuthenticatedPrincipal} from '../../identity/application/scope-guard.ts';
export interface SqlResult<Row> { rows:Row[] }
export interface TransactionConnection { query<Row>(sql:string,params:readonly unknown[]):Promise<SqlResult<Row>> }
export interface TransactionRunner { transaction<T>(fn:(tx:TransactionConnection)=>Promise<T>):Promise<T> }
export interface IssueCustodyInput { id:string; vendorId:string; orderId:string; itemId:string; referenceNo:string; quantity:string; notes?:string }
export class IssueCustodyUseCase {
  private readonly runner:TransactionRunner;
  constructor(runner:TransactionRunner) {this.runner=runner;}
  async execute(principal:AuthenticatedPrincipal,input:IssueCustodyInput):Promise<{id:string;referenceNo:string;remainingQuantity:string}> {
    requireRole(principal,['SUPER_ADMIN']);
    for(const [value,label] of [[input.id,'معرف الحركة'],[input.vendorId,'المنفذ'],[input.orderId,'الطلب'],[input.itemId,'الصنف'],[input.referenceNo,'رقم المرجع']] as const) requireText(value,label);
    if(typeof input.quantity !== 'string' || !/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/.test(input.quantity) || !/[1-9]/.test(input.quantity)) throw new DomainException('INVALID_INPUT','كمية الصرف غير صالحة');
    return this.runner.transaction(async tx=>{
      // The conditional UPDATE locks the item row; a concurrent issue cannot overspend it.
      const stock=await tx.query<{available_quantity:string}>(`UPDATE inventory_items SET available_quantity=available_quantity-$1::numeric,updated_at=CURRENT_TIMESTAMP,updated_by_id=$2 WHERE id=$3 AND is_active=true AND deleted_at IS NULL AND available_quantity >= $1::numeric RETURNING available_quantity::text`,[input.quantity,principal.userId,input.itemId]);
      if(stock.rows.length!==1) throw new DomainException('INVALID_INPUT','الصنف غير متاح أو الرصيد غير كافٍ');
      // The database trigger validates the labor-only contract and assigned order.
      await tx.query(`INSERT INTO custody_transactions (id,vendor_id,order_id,item_id,type,quantity,reference_no,notes,created_by_id) VALUES ($1,$2,$3,$4,'ISSUE',$5::numeric,$6,$7,$8)`,[input.id,input.vendorId,input.orderId,input.itemId,input.quantity,input.referenceNo,input.notes?.trim()||null,principal.userId]);
      return {id:input.id,referenceNo:input.referenceNo,remainingQuantity:stock.rows[0].available_quantity};
    });
  }
}
