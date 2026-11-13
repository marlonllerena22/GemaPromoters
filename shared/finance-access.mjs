export const staffNames={lili:'Liliana',liliana:'Liliana',martha:'Martha',belen:'Belén',nayeli:'Nayely',nayely:'Nayely',yamileth:'Yamileth',selena:'Selena'};
export const isStoreStaff=u=>Boolean(u&&u.role!=='owner'&&staffNames[u.username]);
export const isWarehouse=u=>Boolean(u&&['ana','jose','bodega'].includes(u.username));
export const isLili=u=>Boolean(u&&['lili','liliana'].includes(u.username));
export const canRequestPayments=u=>Boolean(u&&['ana','jose','bodega','norma','normita','morelia','german'].includes(u.username));
export const canSeeAllBalances=u=>Boolean(u&&(u.role==='owner'||u.username==='german'));
export const canSeeAccountBalance=(u,a)=>canSeeAllBalances(u)||(u?.username==='morelia'&&['lili','more-sur'].includes(a?.holder_key));
export const canSeeStoreCash=u=>Boolean(u&&(u.role==='owner'||['german','morelia'].includes(u.username)));
export function profilePermissions(u){return {...u,store_staff:isStoreStaff(u),warehouse_only:isWarehouse(u),request_payments:canRequestPayments(u),checks_manage:u.role==='owner'||['german','morelia','norma','normita'].includes(u.username),checks_clear:u.role==='owner'||u.username==='german',review_unit_ids:isLili(u)?['marjorie-norte','marjorie-valle']:u.username==='morelia'?['marjorie-sur','marjorie-valle']:[],auto_confirm_unit_ids:isLili(u)?['marjorie-norte']:[],balances_visible:canSeeAllBalances(u),store_cash_visible:canSeeStoreCash(u)};}
