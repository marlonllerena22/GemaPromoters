import test from 'node:test';import assert from 'node:assert/strict';import Database from 'better-sqlite3';
import {classifyRetailSupplier,applyRetailSupplier} from '../../shared/finance-retail-suppliers.mjs';
import {initFinanceDb} from '../src/finance-db.js';import {initRetail,retailReport,saveRetailDetails} from '../src/finance-retail.js';
import {importSale} from '../src/finance-service.js';import {normalizeAlfaBusinessSale} from '../src/finance-alfabusiness.js';
const unit='marjorie-bosque',owner={username:'marlon',role:'owner',business_ids:['marjorie'],unit_ids:[]};
const classify=(product,sku)=>classifyRetailSupplier({product,sku},unit);
test('all supplied external models and families are excluded; duplicate entries do not duplicate cost',()=>{
 const groups=[['Juan Cajas',['3A','03','3T','3D','4B','2A','3C','3B','5A','6A','7C','7B','7A','Mocasin 01','Tacón:05','Tacón 07','Tacón 06','Sandalias']],['Aguimashoes',['Moleca','Beira rio']],['Xavier Guerrero',['Boxford','Oxford','Zarleth']],['Xavier Mejía',['TD 022','TD 099','TD 113','TD 115','TD 112','TD 106','TD 084','TD 050','TD999','TD-200']],['Gusmar',['Gusmar','G 900','G300']],['Yolita',['Yolita']],['Discabar',['discabar']],['Bellino',['Bellino']],['Quigu / Elsi',['Quigu','Elsi','4A015','7F006','7F007','3A002']]];
 for(const [supplier,products] of groups)for(const product of products){const result=classify(product);assert.equal(result.producalza,false,product);assert.equal(result.supplier_name,supplier,product);assert.equal(applyRetailSupplier({product,producalza:null},unit).unit_cost_cents,null,product);}
});
test('block 10 and other identified models remain Producalza at $38; matching respects full codes, zeros and store scope',()=>{
 for(const product of ['M6','A1','F2','MY2','MY4','NB1','Z3','MCI','SR1','SH5','A 702 5 1/2 NAPA NEGRO','3A10','A103','TDX 100','4A0150','A702 color 03']){const r=applyRetailSupplier({product,producalza:null},unit);assert.equal(r.producalza,true,product);assert.equal(r.unit_cost_cents,3800,product);}
 assert.equal(classify('03').producalza,false);assert.equal(classify('MOCASÍN 01 CUERO').producalza,false);assert.equal(classify('Botín','TD-022').producalza,false);
 assert.equal(classifyRetailSupplier({product:'TD022'},'marjorie-sur'),null);
 for(const product of ['', 'Calzado','Sin modelo','Detalle por completar'])assert.equal(classify(product).producalza,null);
 assert.equal(classify('Moleca M6','M6').producalza,null);
 assert.equal(applyRetailSupplier({product:'TD022',producalza:true,unit_cost_cents:3800},unit).supplier_rule,'manual');
});
function fixture(t){const db=new Database(':memory:');initFinanceDb(db);initRetail(db);t.after(()=>db.close());const report=()=>retailReport(db,owner,{day:'2026-11-16',mode:'month',unit_id:unit}).stores[0];const body={external_id:'supplier-list-test',unit_id:unit,day:'2026-11-16',state:'active',total_cents:600000,refunded_cents:0,source_updated_at:'2026-11-16T15:00:00Z',payments:[{method:'card',amount_cents:600000}],retail:{items:[{product:'TD 022',sku:'TD022',quantity:30,unit_price_cents:10000,seller:'Belén',size:'38'},{product:'Zapatillas M6',quantity:30,unit_price_cents:10000,seller:'Belén',size:'37'}]}};return {db,body,report};}
test('report classifies existing sales on read, excludes unknown external costs, preserves commission and never writes bank money',t=>{
 const {db,body,report}=fixture(t);const normalized=normalizeAlfaBusinessSale(body);assert.equal(normalized.retail.items[0].sku,'TD022');
 const result=importSale(db,normalized),before=db.prepare('SELECT payload_json FROM finance_sales WHERE id=?').get(result.id).payload_json;
 let r=report();assert.equal(r.sales.pairs,60);assert.equal(r.management.producalza_cents,30*3800);assert.equal(r.management.commission_cents,6000);assert.equal(r.management.card_fee_cents,52200);assert.equal(r.notebook.totals.cost_cents,null);assert.equal(r.notebook.totals.margin_cents,null);assert.equal(r.management.net_cents,null);
 assert.equal(r.sales.entries[0].items[0].supplier_name,'Xavier Mejía');assert.equal(r.sales.entries[0].items[1].unit_cost_cents,3800);
 const draft=r.sales.entries[0].items;saveRetailDetails(db,owner,result.id,{items:draft});assert.equal(report().notebook.rows[0].cost_cents,null);
 saveRetailDetails(db,owner,result.id,{items:draft.map(x=>({...x,unit_cost_cents:x.producalza?3800:2250}))});r=report();assert.equal(r.management.other_products_cents,67500);assert.equal(r.notebook.totals.cost_cents,181500);assert.equal(r.notebook.totals.margin_cents,360300);
 importSale(db,normalizeAlfaBusinessSale({...body,source_updated_at:'2026-11-16T16:00:00Z'}));assert.equal(report().management.other_products_cents,67500);assert.equal(report().sales.count,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_movements').get().n,0);
 assert.equal(JSON.parse(before).retail.items[0].producalza,null);
});
test('external claims cannot supply costs or override the list, changing SKU invalidates old manual classification',t=>{
 const {db,body,report}=fixture(t);const spoof={...body,retail:{items:body.retail.items.map(x=>({...x,producalza:true,unit_cost_cents:1}))}};
 const result=importSale(db,normalizeAlfaBusinessSale(spoof));assert.equal(report().sales.entries[0].items[0].producalza,false);
 const items=report().sales.entries[0].items;saveRetailDetails(db,owner,result.id,{items:items.map(x=>({...x,unit_cost_cents:x.producalza?3800:2100}))});
 importSale(db,normalizeAlfaBusinessSale({...body,source_updated_at:'2026-11-16T17:00:00Z',retail:{items:body.retail.items.map((x,i)=>i?x:{...x,sku:'TD099'})}}));assert.equal(report().sales.entries[0].items[0].unit_cost_cents,null);
});
