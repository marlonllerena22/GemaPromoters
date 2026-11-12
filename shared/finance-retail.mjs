export const RETAIL_STORES = {
  'marjorie-norte': 'Norte', 'marjorie-sur': 'Sur',
  'marjorie-valle': 'Valle', 'marjorie-bosque': "Sebastián’s · Bosque",
};
export const RETAIL_STAFF = ['Liliana', 'Martha', 'Belén', 'Nayely', 'Yamileth', 'Selena'];
export const RETAIL_CATEGORIES = [
  ['pras_cargo','PRAS / CARGO','varios'],
  ['servientrega','Servientrega','varios'], ['transporte','Transporte y motorizado','varios'],
  ['suministros','Suministros','varios'], ['aseo','Aseo','varios'],
  ['mantenimiento','Mantenimiento','varios'], ['otros','Otros gastos','varios'],
  ['arriendo','Arriendo','servicios'], ['luz','Luz','servicios'], ['agua','Agua','servicios'],
  ['internet','Internet','servicios'], ['alarmas','Alarmas','servicios'], ['alicuota','Alícuota','servicios'],
  ['publicidad','Publicidad','publicidad'], ['sueldos','Sueldos','personal'], ['adelantos','Adelantos de sueldo','personal'],
];
export const retailManagement = u => Boolean(u && (u.role === 'owner' || ['morelia','german'].includes(u.username)) && u.business_ids?.includes('marjorie'));
export const retailEditor = u => retailManagement(u) && u.username !== 'german';
export const retailAccess = u => Boolean(u?.business_ids?.includes('marjorie') && (retailManagement(u) || u.unit_ids?.some(id=>RETAIL_STORES[id])));
export const normRetail = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function retailCategory(category, description='') {
  const s=normRetail(category+' '+description);
  const direct=RETAIL_CATEGORIES.find(([id,label])=>normRetail(category)===id||normRetail(category)===normRetail(label));
  if(direct)return direct[0];
  for(const [re,id] of [[/adelant/,'adelantos'],[/sueldo|nomina/,'sueldos'],[/servientrega/,'servientrega'],[/alarma/,'alarmas'],[/alicuota/,'alicuota'],[/arriendo|alquiler/,'arriendo'],[/internet/,'internet'],[/\bluz\b|electric/,'luz'],[/\bagua\b/,'agua'],[/aseo|limpieza|desinfect/,'aseo'],[/pras|\bcargo\b/,'pras_cargo'],[/motorizad|transporte|pasaje|cooperativa/,'transporte'],[/suministro|papeleria/,'suministros'],[/arreglo|reparacion|candado|mantenim/,'mantenimiento'],[/publicidad|facebook|tiktok/,'publicidad']])if(re.test(s))return id;
  return 'otros';
}
export function tierCommission(value, bosque=false) {
  const bounds=bosque?[3500,6000,8500,11000,13500,16000,18500]:[2000,4000,6000,8000,10000,12000,15000];
  const rates=[0,50,75,100,150,200,250,300];
  return rates[bounds.filter(n=>value>=n).length];
}
// Largest remainder allocation keeps every cent when salaries cross stores/days.
export function allocateCents(total, weights) {
  const sum=weights.reduce((a,b)=>a+b,0); if(!sum)return weights.map(()=>0);
  const raw=weights.map(w=>total*w/sum), out=raw.map(Math.floor);
  const order=raw.map((v,i)=>[v-out[i],i]).sort((a,b)=>b[0]-a[0]||a[1]-b[1]);
  for(let k=0,left=total-out.reduce((a,b)=>a+b,0);k<left;k++)out[order[k][1]]++;
  return out;
}
export function defaultRetailSettings() {
  return {threshold:60,commission_basis:'pair',commission_retroactive:true,card_commission:true,card_fee_bps:870,
    staff:RETAIL_STAFF.map(name=>({name,salary_cents:null,extras_cents:0,deductions_cents:0})), fixed:[], coverage_from:null, attendance_complete:false};
}
