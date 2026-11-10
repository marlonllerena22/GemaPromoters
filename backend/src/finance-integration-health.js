import {financeDay} from "./finance-db.js";
import {tableExists} from "./finance-service.js";

// Only operational counters: no customer details, sale amounts or credentials.
export function marjorieIntegrationHealth(db){
  const today=financeDay();
  const rows=db.prepare("SELECT unit_id,COUNT(*) sales,MAX(day) last_sale_day,MAX(source_updated_at) last_source_update,SUM(CASE WHEN day=? THEN 1 ELSE 0 END) today_sales FROM finance_sales WHERE business_id='marjorie' AND source_system='alfabusiness' GROUP BY unit_id ORDER BY unit_id").all(today);
  const sync=db.prepare("SELECT last_run,state FROM finance_sync_log WHERE source='alfabusiness'").get();
  const total=rows.reduce((n,r)=>n+r.sales,0);
  let legacy={available:false};
  if(tableExists(db,"marjorie_promoter_sales"))try{
    const counts=db.prepare("SELECT external_source source,COUNT(*) sales,MAX(updated_at) last_update,SUM(CASE WHEN sale_date=? THEN 1 ELSE 0 END) today_sales FROM marjorie_promoter_sales WHERE COALESCE(external_source,'')!='' GROUP BY external_source ORDER BY external_source").all(today);
    legacy={available:true,total:counts.reduce((n,r)=>n+r.sales,0),sources:counts};
  }catch{legacy={available:false};}
  return {checked_at:new Date().toISOString(),today,financial:{configured:Boolean(process.env.FINANCE_SALES_WEBHOOK_SECRET?.length>=32),state:total?"has_deliveries":"awaiting_first_sale",total_sales:total,last_accepted_at:sync?.last_run||null,by_store:rows},legacy_promoters:legacy,coverage_verified:false};
}
