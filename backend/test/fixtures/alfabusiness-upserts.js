// Financial fields supplied by the sender for the two rejected deliveries.
// Tax access keys are redacted because the adapter does not consume them.
export const alfaBusinessUpserts=[
  {id:866,invoice:'000000104',branch:2,name:'Quito Sur',unit:'marjorie-sur',sold:'2026-11-10T16:57:03-05:00',updated:'2026-11-11T16:27:54-05:00',subtotal:126.09,discount:3,total:145},
  {id:870,invoice:'000000252',branch:4,name:'JC SEBASTIAN — Paseo El Bosque',unit:'marjorie-bosque',sold:'2026-11-11T18:36:57-05:00',updated:'2026-11-11T18:47:02-05:00',subtotal:163.48,discount:0,total:188},
].map(s=>({
  event:'sale.upserted',occurred_at:'2026-11-11T21:48:21-05:00',unit_id:s.unit,local:s.unit,
  sale:{id:s.id,invoice_number:s.invoice,clave_acceso:'REDACTED-NOT-USED-BY-FINANCE',branch_id:s.branch,branch_name:s.name,location:s.unit,local:s.unit,
    sold_at:s.sold,updated_at:s.updated,subtotal:s.subtotal,discount:s.discount,total:s.total,amount_paid:s.total,balance_due:0,currency:'USD',
    payment_methods:[{method:'tarjeta',amount:s.total}],payments:[],
    status:{comprobante_type:'factura_electronica',invoice_status:'invoiced',fulfillment_status:null,invoice_void_status:null,is_voided:false},
    void:null,returns:[],promo_code:null}
}));
