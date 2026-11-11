export const notificationBankCode=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/banco|del|de|[^a-z]/g,'');
export const acceptsBankNotification=(account,bank)=>notificationBankCode(account.bank)===notificationBankCode(bank)&&(account.kind==='bank'||(account.kind==='wallet'&&notificationBankCode(bank)===notificationBankCode('Deuna')));
export function soleDeunaAccount(accounts){
  const candidates=accounts.filter(a=>a.active!==0&&acceptsBankNotification(a,'Deuna'));
  return candidates.length===1?candidates[0]:null;
}
