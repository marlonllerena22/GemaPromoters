const ignored=new Set(['de','del','el','la','los','las','y','sr','sra']);
const parts=value=>[...new Set(String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z]{2,}/g)||[])].filter(w=>!ignored.has(w));
export function matchingBankPerson(a,b){
  const one=parts(a),two=parts(b);
  return one.length>=2&&two.length>=2&&(one.every(w=>two.includes(w))||two.every(w=>one.includes(w)));
}
export function receivedWithoutAccount(row,p){
  return row.state==='review'&&!row.account_id&&p.direction==='incoming'&&Number.isSafeInteger(p.amount_cents)&&p.amount_cents>0&&!p.blocked&&!p.credit;
}
