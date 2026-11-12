import {audit, cents, financeDay, validDay} from './finance-db.js';
import {fail, unitAccess, createMovement, text} from './finance-service.js';
import {RETAIL_STORES, RETAIL_STAFF, RETAIL_CATEGORIES, retailAccess, retailManagement, retailEditor, retailCategory, tierCommission, allocateCents, defaultRetailSettings, normRetail} from '../../shared/finance-retail.mjs';

export function initRetail(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS finance_retail_settings(month TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_retail_details(sale_id INTEGER PRIMARY KEY REFERENCES finance_sales(id), source_version TEXT NOT NULL, data_json TEXT NOT NULL, updated_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_retail_attendance(day TEXT NOT NULL, unit_id TEXT NOT NULL REFERENCES finance_units(id), employee TEXT NOT NULL, weight REAL NOT NULL CHECK(weight>0 AND weight<=1), PRIMARY KEY(day,unit_id,employee));
    CREATE TABLE IF NOT EXISTS finance_retail_cash_start(unit_id TEXT NOT NULL REFERENCES finance_units(id), day TEXT NOT NULL, amount_cents INTEGER NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY(unit_id,day));
    CREATE TABLE IF NOT EXISTS finance_retail_entries(id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, unit_id TEXT NOT NULL REFERENCES finance_units(id), day TEXT NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, description TEXT NOT NULL, counterparty TEXT NOT NULL, movement_id INTEGER REFERENCES finance_movements(id), created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_retail_counts(unit_id TEXT NOT NULL REFERENCES finance_units(id), day TEXT NOT NULL, amount_cents INTEGER NOT NULL, note TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY(unit_id,day));`);
}
const addDay=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const monthEnd=m=>addDay(new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),1)).toISOString().slice(0,10),-1);
function monthKey(m){validDay(m+'-01');return m;}
export function retailPeriod(q={}) {
  const day=validDay(q.day||financeDay()), mode=q.mode||'month'; let from=day,to=day;
  if(mode==='week'){from=addDay(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));to=addDay(from,6);}
  else if(mode==='month'){from=day.slice(0,7)+'-01';to=monthEnd(day.slice(0,7));}
  else if(mode!=='day')fail('Selecciona día, semana o mes');
  return {mode,day,from,to};
}
function access(db,u,unit,edit=false){
  if(!retailAccess(u))fail('No tienes acceso a reportes de locales',403);
  if(edit&&!retailEditor(u))fail('Solo Marlon y Morelia pueden editar esta configuración',403);
  if(unit){if(!RETAIL_STORES[unit])fail('Local no válido');unitAccess(db,u,unit,'marjorie');}
}
export function retailSettings(db,month) {
  monthKey(month);
  const row=db.prepare('SELECT * FROM finance_retail_settings WHERE month<=? ORDER BY month DESC LIMIT 1').get(month);
  const saved=row?JSON.parse(row.data_json):{};
  return {...defaultRetailSettings(),...saved,attendance_complete:row?.month===month&&saved.attendance_complete===true,inherited_from:row?.month||null};
}
export function saveRetailSettings(db,u,body) {
  access(db,u,null,true);const month=monthKey(body.month), old=retailSettings(db,month), s=body.settings;
  if(!s||!Array.isArray(s.staff)||s.staff.length!==RETAIL_STAFF.length||!Array.isArray(s.fixed)||s.fixed.length>100)fail('Configuración incompleta');
  if(new Set(s.staff.map(x=>x.name)).size!==RETAIL_STAFF.length||s.staff.some(x=>!RETAIL_STAFF.includes(x.name)))fail('Revisa las empleadas');
  const config={...defaultRetailSettings(),card_fee_bps:cents(s.card_fee_bps,{zero:true}),staff:s.staff.map(x=>({name:x.name,salary_cents:x.salary_cents===null?null:cents(x.salary_cents,{zero:true}),extras_cents:cents(x.extras_cents??0,{zero:true}),deductions_cents:cents(x.deductions_cents??0,{zero:true})})),
    fixed:s.fixed.map(x=>{if(!RETAIL_STORES[x.unit_id]||!RETAIL_CATEGORIES.some(([id,,group])=>id===x.category&&group!=='personal'))fail('Gasto fijo no válido');return {unit_id:x.unit_id,category:x.category,amount_cents:cents(x.amount_cents,{zero:true}),description:text(x.description,300)};}),
    coverage_from:s.coverage_from?validDay(s.coverage_from):null,attendance_complete:s.attendance_complete===true};
  if(config.card_fee_bps>10000)fail('La comisión no puede superar el 100%');
  if(new Set(config.fixed.map(x=>x.unit_id+':'+x.category)).size!==config.fixed.length)fail('Agrupa el gasto fijo de cada categoría una sola vez por local');
  db.transaction(()=>{db.prepare('INSERT INTO finance_retail_settings VALUES (?,?,?) ON CONFLICT(month) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by').run(month,JSON.stringify(config),u.username);audit(db,u.username,'retail.settings','retail_settings',month,old,config,'marjorie');})();
  return config;
}
// Details describe net sold pairs, after discounts/returns. They never create sales or bank money.
export function validateRetailDetails(value,sale) {
  if(!value||!Array.isArray(value.items)||value.items.length<1||value.items.length>200)fail('Añade los productos vendidos');
  const items=value.items.map(x=>{
    if(!Number.isSafeInteger(x.quantity)||x.quantity<1||x.quantity>10000||!RETAIL_STAFF.includes(x.seller)||typeof x.producalza!=='boolean')fail('Completa pares, vendedora y proveedor');
    return {product:text(x.product,150)||'Calzado',size:text(x.size,40),quantity:x.quantity,seller:x.seller,unit_price_cents:cents(x.unit_price_cents,{zero:true}),producalza:x.producalza,unit_cost_cents:x.producalza?3800:cents(x.unit_cost_cents,{zero:true})};
  });
  if(items.reduce((n,x)=>n+x.quantity*x.unit_price_cents,0)!==sale.total_cents-sale.refunded_cents)fail('Los importes de los pares deben coincidir con la venta neta. Incluye los descuentos y pares devueltos.');
  return {items};
}
export function saveRetailDetails(db,u,id,body) {
  const sale=db.prepare('SELECT * FROM finance_sales WHERE id=? AND business_id=?').get(id,'marjorie');if(!sale)fail('Venta no encontrada',404);
  access(db,u,sale.unit_id,true);const details=validateRetailDetails(body,sale),old=db.prepare('SELECT * FROM finance_retail_details WHERE sale_id=?').get(id);
  db.transaction(()=>{db.prepare('INSERT INTO finance_retail_details VALUES (?,?,?,?) ON CONFLICT(sale_id) DO UPDATE SET source_version=excluded.source_version,data_json=excluded.data_json,updated_by=excluded.updated_by').run(id,sale.source_updated_at,JSON.stringify(details),u.username);audit(db,u.username,'retail.sale_details','sale',id,old,details,'marjorie');})();return details;
}
export function retailAttendance(db,u,body) {
  access(db,u,body.unit_id,true);const day=validDay(body.day);if(day>financeDay())fail('Registra solo días ya trabajados');
  if(!RETAIL_STAFF.includes(body.employee))fail('Empleada no válida');
  const weight=Number(body.weight);if(![0,0.5,1].includes(weight))fail('Elige día completo, medio día o quitar');
  return db.transaction(()=>{
    const previous=db.prepare('SELECT * FROM finance_retail_attendance WHERE day=? AND employee=? AND unit_id=?').get(day,body.employee,body.unit_id);
    const other=db.prepare('SELECT COALESCE(SUM(weight),0) n FROM finance_retail_attendance WHERE day=? AND employee=? AND unit_id<>?').get(day,body.employee,body.unit_id).n;
    if(other+weight>1)fail('Ya completaste el día de esta empleada en otro local');
    if(weight)db.prepare('INSERT INTO finance_retail_attendance VALUES (?,?,?,?) ON CONFLICT(day,unit_id,employee) DO UPDATE SET weight=excluded.weight').run(day,body.unit_id,body.employee,weight);
    else db.prepare('DELETE FROM finance_retail_attendance WHERE day=? AND unit_id=? AND employee=?').run(day,body.unit_id,body.employee);
    audit(db,u.username,'retail.attendance','retail_attendance',day+body.employee,previous,body,'marjorie');return {ok:true};
  })();
}
export function editRetailExpense(db,u,id,body){
  const old=db.prepare("SELECT * FROM finance_movements WHERE id=? AND business_id='marjorie' AND kind='expense'").get(id);
  if(!old)fail('Gasto no encontrado',404);access(db,u,old.unit_id,true);
  if(!RETAIL_CATEGORIES.some(([k])=>k===body.category)||!text(body.description))fail('Completa concepto y descripción');
  const value=cents(body.amount_cents),linked=db.prepare('SELECT COUNT(*) n FROM finance_allocations WHERE movement_id=?').get(id).n;
  if(value!==old.amount_cents&&(old.payment_method!=='cash'||linked||old.account_id))fail('El importe está ligado a una cuenta. Corrígelo desde el movimiento original para conservar la conciliación.');
  if(db.prepare('SELECT id FROM finance_closings WHERE unit_id=? AND day=?').get(old.unit_id,old.day))fail('Reabre el cierre antes de editar este gasto',409);
  db.transaction(()=>{db.prepare("UPDATE finance_movements SET category=?,description=?,amount_cents=?,updated_at=? WHERE id=?").run(RETAIL_CATEGORIES.find(([k])=>k===body.category)[1],text(body.description,1000),value,new Date().toISOString(),id);
    db.prepare('UPDATE finance_retail_entries SET amount_cents=?,description=? WHERE movement_id=?').run(value,text(body.description,1000),id);
    audit(db,u.username,'retail.expense_edited','movement',id,old,body,'marjorie');})();return {ok:true};
}
export function retailEntry(db,u,body) {
  access(db,u,body.unit_id);if(u.role==='viewer')fail('Acceso de consulta',403);
  const day=validDay(body.day);if(day>financeDay())fail('La fecha no puede ser futura');
  const amount=cents(body.amount_cents,{zero:['opening','count'].includes(body.kind)});
  const description=text(body.description,1000),counterparty=text(body.counterparty)||u.name;
  if(!description)fail('Escribe una descripción');
  if(!['expense','funding','remittance','opening','count'].includes(body.kind))fail('Tipo no válido');
  if(['opening','funding'].includes(body.kind)&&!retailEditor(u))fail('Solo Marlon y Morelia pueden asignar fondos iniciales',403);
  if(body.kind==='expense'&&!RETAIL_CATEGORIES.some(([id])=>id===body.category))fail('Selecciona el concepto del gasto');
  const id=text(body.request_id,100);if(!id)fail('Falta el identificador de guardado');
  const fp=JSON.stringify([body.unit_id,day,body.kind,amount,description,counterparty,body.category||null]);
  return db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM finance_retail_entries WHERE request_id=?').get(id);if(prior){if(prior.fingerprint!==fp)fail('Esta solicitud ya se guardó con otros datos',409);return {id:prior.id,duplicate:true};}
    let movement=null;
    if(body.kind==='opening'){
      const before=db.prepare('SELECT * FROM finance_retail_cash_start WHERE unit_id=? AND day=?').get(body.unit_id,day);
      db.prepare('INSERT INTO finance_retail_cash_start VALUES (?,?,?,?) ON CONFLICT(unit_id,day) DO UPDATE SET amount_cents=excluded.amount_cents,updated_by=excluded.updated_by').run(body.unit_id,day,amount,u.username);
      audit(db,u.username,'retail.cash_opening','retail_cash',body.unit_id,before,body,'marjorie');
    }else if(body.kind==='count'){
      const before=db.prepare('SELECT * FROM finance_retail_counts WHERE unit_id=? AND day=?').get(body.unit_id,day);
      db.prepare('INSERT INTO finance_retail_counts VALUES (?,?,?,?,?) ON CONFLICT(unit_id,day) DO UPDATE SET amount_cents=excluded.amount_cents,note=excluded.note,updated_by=excluded.updated_by').run(body.unit_id,day,amount,description,u.username);
      audit(db,u.username,'retail.cash_count','retail_count',body.unit_id+day,before,body,'marjorie');
    }else if(body.kind==='expense'){
      movement=createMovement(db,u,{business_id:'marjorie',unit_id:body.unit_id,kind:'expense',amount_cents:amount,day,category:RETAIL_CATEGORIES.find(([id])=>id===body.category)[1],counterparty,description,payment_method:'cash'});
      // Explicit cash already spent, not a request for a bank transfer.
      db.prepare("UPDATE finance_movements SET status='reconciled',reviewed_by=?,review_note='Gasto pagado desde caja del local' WHERE id=?").run(u.username,movement.id);
    }
    const result=db.prepare('INSERT INTO finance_retail_entries(request_id,fingerprint,unit_id,day,kind,amount_cents,description,counterparty,movement_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,fp,body.unit_id,day,body.kind,amount,description,counterparty,movement?.id||null,u.username);
    audit(db,u.username,'retail.cash_entry','retail_entry',result.lastInsertRowid,null,{...body,movement_id:movement?.id},'marjorie');
    return {id:result.lastInsertRowid};
  })();
}
const sum=(rows,f)=>rows.reduce((n,x)=>n+f(x),0);
function detailsOf(db,sale){
  const manual=db.prepare('SELECT * FROM finance_retail_details WHERE sale_id=?').get(sale.id);
  const source=JSON.parse(sale.payload_json).retail;
  const value=manual?.source_version===sale.source_updated_at?JSON.parse(manual.data_json):source;
  try{return validateRetailDetails(value,sale);}catch{return null;}
}
export function retailReport(db,u,q={}) {
  access(db,u,q.unit_id&&q.unit_id!=='all'?q.unit_id:null);
  const period=retailPeriod(q), {from,to}=period, management=retailManagement(u);
  const units=Object.keys(RETAIL_STORES).filter(id=>(!u.unit_ids.length||u.unit_ids.includes(id))&&(!q.unit_id||q.unit_id==='all'||q.unit_id===id));
  const allSales=db.prepare("SELECT * FROM finance_sales WHERE business_id='marjorie' AND day<=? ORDER BY day,id").all(monthEnd(to.slice(0,7)));
  const allMovements=db.prepare("SELECT * FROM finance_movements WHERE business_id='marjorie' AND day<=? AND status<>'rejected' ORDER BY day,id").all(to);
  const attendance=db.prepare('SELECT * FROM finance_retail_attendance WHERE day BETWEEN ? AND ? ORDER BY day,unit_id,employee').all(from.slice(0,7)+'-01',monthEnd(to.slice(0,7)));
  const allEntries=db.prepare('SELECT * FROM finance_retail_entries WHERE day<=? ORDER BY day,id').all(to);
  const months=[...new Set(Array.from({length:Math.round((Date.parse(to)-Date.parse(from))/86400000)+1},(_,i)=>addDay(from,i).slice(0,7)))];
  const settings=Object.fromEntries(months.map(m=>[m,retailSettings(db,m)]));
  const selected=day=>day>=from&&day<=to;
  const stores=units.map(unit=>{
    const all=allSales.filter(s=>s.unit_id===unit), active=all.filter(s=>s.state==='active'), sales=active.filter(s=>selected(s.day));
    const detailMap=new Map(active.map(s=>[s.id,detailsOf(db,s)]));
    const payments=sales.flatMap(s=>JSON.parse(s.payments_json));
    const breakdown=Object.fromEntries(['cash','transfer','card','payphone','other'].map(method=>[method,sum(payments.filter(p=>p.method===method),p=>p.amount_cents-(p.refunded_cents||0))]));
    const gross=sum(sales,s=>s.total_cents), refunds=sum(sales,s=>s.refunded_cents), net=gross-refunds;
    const movements=allMovements.filter(m=>m.unit_id===unit),accepted=movements.filter(m=>['approved','reconciled'].includes(m.status));
    const expenses=accepted.filter(m=>selected(m.day)&&m.kind==='expense').map(m=>({...m,retail_category:retailCategory(m.category,m.description)}));
    const categories=RETAIL_CATEGORIES.map(([id,label,group])=>({id,label,group,amount_cents:sum(expenses.filter(m=>m.retail_category===id),m=>m.amount_cents),entries:expenses.filter(m=>m.retail_category===id)}));
    const missing=[];if(sales.some(s=>!detailMap.get(s.id)))missing.push('Completar productos, pares, proveedor y vendedora de '+sales.filter(s=>!detailMap.get(s.id)).length+' ventas');
    if(sales.some(s=>sum(JSON.parse(s.payments_json),p=>p.amount_cents-(p.refunded_cents||0))!==s.total_cents-s.refunded_cents))missing.push('Hay ventas con cobros incompletos: revisar abonos y fechas de cobro');
    if(breakdown.payphone>0)missing.push('Revisar comisión de PayPhone de estas ventas');
    if(movements.some(m=>selected(m.day)&&m.kind==='expense'&&['pending','reported'].includes(m.status)))missing.push('Hay gastos pendientes de aprobación');
    if(all.some(s=>selected(s.day)&&['pending','refunded','cancelled'].includes(s.state)))missing.push('Revisar caja de reservas, anulaciones y devoluciones con sus fechas de cobro');
    let cost=0,producalza=0,commissions=0,salaries=0,fixedPending=0,fees=0;
    const personnel=[],fixed=[],thresholds=[];
    for(const month of months){
      const cfg=settings[month],ms=active.filter(s=>s.day.startsWith(month)),monthSelected=sales.filter(s=>s.day.startsWith(month));
      const knownPairs=sum(ms,s=>sum(detailMap.get(s.id)?.items||[],x=>x.quantity));
      const complete=ms.every(s=>detailMap.get(s.id));
      thresholds.push({month,pairs:knownPairs,complete,target:cfg.threshold,eligible:knownPairs>=cfg.threshold});
      if(!complete)missing.push('Pares del mes incompletos: la comisión podría cambiar');
      for(const s of monthSelected){
        const items=detailMap.get(s.id)?.items||[];
        for(const item of items){cost+=item.quantity*item.unit_cost_cents;if(item.producalza)producalza+=item.quantity*3800;
          const commission=knownPairs>=cfg.threshold?item.quantity*tierCommission(item.unit_price_cents,unit==='marjorie-bosque'):0;
          commissions+=commission;let p=personnel.find(p=>p.month===month&&p.name===item.seller);if(!p){p={month,name:item.seller,commission_cents:0,salary_cents:0,days:0};personnel.push(p);}p.commission_cents+=commission;
        }
        fees+=Math.round(sum(JSON.parse(s.payments_json).filter(p=>p.method==='card'),p=>p.amount_cents-(p.refunded_cents||0))*cfg.card_fee_bps/10000);
      }
      const assignments={'marjorie-bosque':['Martha','Belén'],'marjorie-norte':['Liliana','Martha'],'marjorie-valle':['Nayely','Yamileth'],'marjorie-sur':['Selena','Yamileth']}[unit];
      for(const employee of cfg.staff){
        const worked=attendance.filter(a=>a.day.startsWith(month)&&a.employee===employee.name),local=worked.filter(a=>a.unit_id===unit&&selected(a.day));
        if(!assignments.includes(employee.name)&&!local.length)continue;
        if(employee.salary_cents===null)missing.push('Falta sueldo vigente de '+employee.name);
        if(!worked.length)missing.push('Faltan días trabajados de '+employee.name);
        const allocations=allocateCents((employee.salary_cents||0)+(employee.extras_cents||0),worked.map(a=>a.weight));
        const allocated=sum(worked.map((a,i)=>({...a,cents:allocations[i]})).filter(a=>a.unit_id===unit&&selected(a.day)),a=>a.cents);
        salaries+=allocated;let p=personnel.find(p=>p.month===month&&p.name===employee.name);if(!p){p={month,name:employee.name,commission_cents:0,salary_cents:0,days:0};personnel.push(p);}p.salary_cents+=allocated;p.days=sum(local,a=>a.weight); const deductions=allocateCents(employee.deductions_cents||0,worked.map(a=>a.weight)); p.deductions_cents=sum(worked.map((a,i)=>({...a,cents:deductions[i]})).filter(a=>a.unit_id===unit&&selected(a.day)),a=>a.cents); p.advances_cents=sum(expenses.filter(m=>m.day.startsWith(month)&&m.retail_category==='adelantos'&&normRetail(m.counterparty).split(/\s+/).includes(normRetail(employee.name))),m=>m.amount_cents); p.payable_cents=p.salary_cents+p.commission_cents-p.deductions_cents-p.advances_cents;
      }
      const periodDays=Math.round((Date.parse(to<monthEnd(month)?to:monthEnd(month))-Date.parse(from>month+'-01'?from:month+'-01'))/86400000)+1;
      for(const f of cfg.fixed.filter(f=>f.unit_id===unit)){
        const monthActual=accepted.filter(m=>m.day.startsWith(month)&&m.kind==='expense'&&retailCategory(m.category,m.description)===f.category);
        const planned=Math.round(f.amount_cents*periodDays/Number(monthEnd(month).slice(-2)));
        const pending=monthActual.length?0:planned;fixedPending+=pending;
        fixed.push({...f,month,planned_cents:planned,recorded_cents:sum(monthActual,m=>m.amount_cents),pending_cents:pending});
      }
      if(!cfg.fixed.some(f=>f.unit_id===unit))missing.push('Revisar gastos fijos vigentes del local');
      if(!cfg.attendance_complete)missing.push('Confirmar que las jornadas del mes están completas');
      if(!cfg.coverage_from||from<cfg.coverage_from)missing.push('Cobertura de ventas del período pendiente de comprobar');
    }
    const operational=sum(expenses.filter(m=>!['sueldos','adelantos'].includes(m.retail_category)),m=>m.amount_cents);
    const cashStart=db.prepare('SELECT * FROM finance_retail_cash_start WHERE unit_id=? AND day<=? ORDER BY day DESC LIMIT 1').get(unit,to);
    const cashFrom=cashStart?.day||from;
    const cashFlows=[...active.flatMap(s=>JSON.parse(s.payments_json).filter(p=>p.method==='cash').map(p=>({day:s.day,description:'Venta '+s.external_id,amount_cents:p.amount_cents-(p.refunded_cents||0),kind:'sale'}))),
      ...accepted.filter(m=>m.kind==='expense'&&m.payment_method==='cash'&&m.status==='reconciled').map(m=>({day:m.day,description:m.description||m.category,amount_cents:-m.amount_cents,kind:'expense'})),
      ...allEntries.filter(e=>e.unit_id===unit&&['funding','remittance'].includes(e.kind)).map(e=>({...e,amount_cents:e.amount_cents*(e.kind==='remittance'?-1:1)}))].filter(x=>x.day>=cashFrom&&x.day<=to).sort((a,b)=>a.day.localeCompare(b.day));
    const opening=cashStart&&cashStart.day<=from?cashStart.amount_cents+sum(cashFlows.filter(e=>e.day<from),e=>e.amount_cents):null;
    const cashTotal=cashStart&&cashStart.day<=to?cashStart.amount_cents+sum(cashFlows,e=>e.amount_cents):null;
    const counted=db.prepare('SELECT * FROM finance_retail_counts WHERE unit_id=? AND day BETWEEN ? AND ? ORDER BY day DESC LIMIT 1').get(unit,from,to); const countExpected=counted&&cashStart&&cashStart.day<=counted.day?cashStart.amount_cents+sum(cashFlows.filter(e=>e.day<=counted.day),e=>e.amount_cents):null;
    const warnings=[...new Set(missing)];
    const result={unit_id:unit,name:RETAIL_STORES[unit],sales:{gross_cents:gross,refund_cents:refunds,net_cents:net,breakdown,count:sales.length,pairs:sum(sales,s=>sum(detailMap.get(s.id)?.items||[],x=>x.quantity)),thresholds,
      entries:sales.map(s=>({id:s.id,external_id:s.external_id,document_number:s.document_number,day:s.day,net_cents:s.total_cents-s.refunded_cents,payments:JSON.parse(s.payments_json),items:detailMap.get(s.id)?.items?.map(({unit_cost_cents,...x})=>management?{...x,unit_cost_cents}:x)||null}))},
      expenses:categories.filter(c=>management||c.group!=='personal'),
      cash:{opening_cents:opening,balance_cents:cashTotal,start:cashStart,counted_cents:counted?.amount_cents??null,counted_day:counted?.day||null,difference_cents:counted&&countExpected!==null?counted.amount_cents-countExpected:null,entries:cashFlows.filter(e=>selected(e.day)),incomplete:!cashStart||!settings[from.slice(0,7)].coverage_from},
      remittances:allEntries.filter(e=>e.unit_id===unit&&e.kind==='remittance'&&selected(e.day)),direct_deposits:accepted.filter(m=>m.kind==='income'&&m.status==='reconciled'&&m.payment_method!=='cash'&&selected(m.day)).map(m=>({id:m.id,day:m.day,description:m.description,counterparty:m.counterparty,amount_cents:m.amount_cents,account_name:db.prepare('SELECT name FROM finance_accounts WHERE id=?').get(m.account_id)?.name||'Cuenta por identificar'})),pending_expenses:movements.filter(m=>selected(m.day)&&m.kind==='expense'&&['pending','reported'].includes(m.status)).length,
      warnings};
    if(management)result.management={card_fee_cents:fees,card_fee_estimated:true,producalza_cents:producalza,other_products_cents:cost-producalza,salary_cents:salaries,commission_cents:commissions,operating_cents:operational,fixed_pending_cents:fixedPending,fixed,personnel,net_provisional_cents:net-fees-cost-salaries-commissions-operational-fixedPending,complete:warnings.length===0,net_cents:warnings.length?null:net-fees-cost-salaries-commissions-operational-fixedPending};
    return result;
  });
  return {period,stores,can_manage:management,can_edit:retailEditor(u),can_operate:u.role!=='viewer',categories:RETAIL_CATEGORIES,staff:RETAIL_STAFF,
    attendance:management?attendance.filter(a=>units.includes(a.unit_id)):[],
    total:{sales_cents:sum(stores,s=>s.sales.net_cents),cash_cents:stores.every(s=>s.cash.balance_cents!==null)?sum(stores,s=>s.cash.balance_cents):null,...(management?{net_cents:stores.every(s=>s.management.complete)?sum(stores,s=>s.management.net_cents):null,net_provisional_cents:sum(stores,s=>s.management.net_provisional_cents)}:{})},
    ...(retailEditor(u)?{settings:settings[period.day.slice(0,7)],settings_month:period.day.slice(0,7)}:{})};
}
export function registerRetailRoutes(app,db,{route}) {
  initRetail(db);
  app.get('/api/finance/retail/report',route((req,res)=>res.json(retailReport(db,req.financeUser,req.query))));
  app.post('/api/finance/retail/settings',route((req,res)=>res.json(saveRetailSettings(db,req.financeUser,req.body))));
  app.post('/api/finance/retail/sales/:id/details',route((req,res)=>res.json(saveRetailDetails(db,req.financeUser,Number(req.params.id),req.body))));
  app.post('/api/finance/retail/attendance',route((req,res)=>res.json(retailAttendance(db,req.financeUser,req.body))));
  app.post('/api/finance/retail/cash',route((req,res)=>res.json(retailEntry(db,req.financeUser,req.body))));
  app.post('/api/finance/retail/expenses/:id',route((req,res)=>res.json(editRetailExpense(db,req.financeUser,Number(req.params.id),req.body))));
}
