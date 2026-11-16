// Sebastián's list supplied by Marlon, 2026-11-16. Block 10 is Producalza.
// Scope is Bosque; this catalog must not classify another store's products.
export const SEBASTIANS_SUPPLIER_VERSION='sebastians-2026-11-16';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const codeStart=s=>s.replace(/^(?:(?:TACON(?:ES)?|ZAPATILLAS?|ZAPATOS?|MODELO|REF|REFERENCIA)\s+)+/,'');
const juan=new Set(['3A','03','3T','3D','4B','2A','3C','3B','5A','6A','7C','7B','7A','05','07','06']);
const elsi=new Set(['4A015','7F006','7F007','3A002']);
const producalza=new Set(['M6','A1','F2','MY2','MY4','NB1','Z3','MCI','SR1','SH5']);
const named=[[/\bJUAN CAJAS\b/,'Juan Cajas'],[/\b(?:AGUIMASHOES|MOLECA|BEIRA RIO)\b/,'Aguimashoes'],[/\b(?:XAVIER GUERRERO|BOXFORD|OXFORD|ZARLETH)\b/,'Xavier Guerrero'],[/\bXAVIER MEJIA\b/,'Xavier Mejía'],[/\bGUSMAR\b/,'Gusmar'],[/\bYOLITA\b/,'Yolita'],[/\bDISCABAR\b/,'Discabar'],[/\bBELLINO\b/,'Bellino'],[/\b(?:QUIGU|ELSI)\b/,'Quigu / Elsi']];
export function classifyRetailSupplier(item,unit){
 if(unit!=='marjorie-bosque')return null;
 const values=[normalize(item.product),normalize(item.sku)].filter(Boolean),matches=new Set();
 for(const value of values){
  const start=codeStart(value),first=start.split(' ')[0];
  for(const [pattern,name] of named)if(pattern.test(value))matches.add(name);
  if(juan.has(first)||/^MOCASIN\s*0?1(?:\s|$)/.test(start)||/\bSANDALIAS?\b/.test(value))matches.add('Juan Cajas');
  if(/^TD(?:\s*\d+[A-Z0-9]*|$)(?:\s|$)/.test(start))matches.add('Xavier Mejía');
  if(/^G(?:\s*\d+[A-Z0-9]*|$)(?:\s|$)/.test(start))matches.add('Gusmar');
  if(elsi.has(first))matches.add('Quigu / Elsi');
  if(producalza.has(first)||/\bPRODUCALZA\b/.test(value))matches.add('Producalza');
 }
 if(matches.size>1)return {producalza:null,supplier_name:null,supplier_rule:'conflict',supplier_version:SEBASTIANS_SUPPLIER_VERSION};
 if(matches.size===1){const name=[...matches][0];return {producalza:name==='Producalza',supplier_name:name,supplier_rule:'catalog',supplier_version:SEBASTIANS_SUPPLIER_VERSION};}
 const generic=/^(?:CALZADO|BOTIN|BOTA|ZAPATO|ZAPATILLA|PRODUCTO|SIN MODELO|SIN IDENTIFICAR|DETALLE POR COMPLETAR|DESCONOCIDO)S?$/;
 if(!values.some(v=>!generic.test(v)))return {producalza:null,supplier_name:null,supplier_rule:'missing_model',supplier_version:SEBASTIANS_SUPPLIER_VERSION};
 return {producalza:true,supplier_name:'Producalza',supplier_rule:'default',supplier_version:SEBASTIANS_SUPPLIER_VERSION};
}
export function applyRetailSupplier(item,unit){
 // Explicit local classification/cost always wins. Incoming provider fields are
 // stripped by the integration before they can reach this function.
 if(typeof item.producalza==='boolean'){const known=classifyRetailSupplier(item,unit);return {...item,supplier_name:item.producalza?'Producalza':known?.producalza===false?known.supplier_name:'Otro proveedor',supplier_rule:'manual'};}
 const result=classifyRetailSupplier(item,unit);if(!result)return item;
 return {...item,...result,unit_cost_cents:result.producalza===true?3800:null};
}
