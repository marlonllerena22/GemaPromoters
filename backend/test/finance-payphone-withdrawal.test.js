import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initFinanceDb} from '../src/finance-db.js';
import {applyBankReview} from '../src/finance-bank-review.js';
import {recordedAccountBalance} from '../src/finance-check-ledger.js';
import {privateSetting} from '../src/finance-operations.js';
process.env.FINANCE_DOCUMENT_KEY='test-only-payphone-withdrawal-secret';
function fixture(t){
 const db=new Database(':memory:');initFinanceDb(db);t.after(()=>db.close());
 const id=Number(db.prepare("INSERT INTO finance_accounts(business_id,name,bank,kind,opening_cents,opening_date) VALUES ('gemashow','PayPhone','PayPhone','wallet',534795,'2026-11-01')").run().lastInsertRowid);
 const at=new Date(Date.now()-1000).toISOString();
 const config={kind:'bank-review-v1',id:'withdrawal-test',expires_at:new Date(Date.now()+60000).toISOString(),messages:[],wallet_custody_transfers:[{confirmed:true,custody_id:'xavi-pichincha',amount_cents:500000,expected_wallet_cents:534795,expected_custody_version:0,expected_custody_cents:null,occurred_at:at,source_hash:'a'.repeat(64)}],wallet_balances:[{provider:'payphone',balance_cents:223295,expected_balance_cents:34795,as_of_at:at,source_hash:'b'.repeat(64),reconciliation_note:'Diferencia pendiente de identificar en historial PayPhone'}]};
 return {db,id,config,balance:()=>recordedAccountBalance(db,db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(id))};
}
test('confirmed withdrawal moves funds to Xavi once; official balance preserves an unexplained reconciliation difference',t=>{
 const f=fixture(t);assert.equal(applyBankReview(f.db,f.config).custodyTransfers.length,1);
 assert.equal(f.balance(),223295);assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='xavi-pichincha'").get().balance_cents,500000);
 assert.equal(privateSetting(f.db,'payphone_reconciliation_pending').difference_cents,188500);
 assert.equal(f.db.prepare("SELECT count(*) n FROM finance_movements WHERE kind IN ('income','expense')").get().n,0);
 assert.equal(applyBankReview(f.db,f.config).applied,false);
 const duplicate={...f.config,id:'withdrawal-retry',wallet_balances:[]};assert.equal(applyBankReview(f.db,duplicate).custodyTransfers[0].duplicate,true);
 assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM finance_custody_adjustments').get().n,1);
 assert.throws(()=>applyBankReview(f.db,{...duplicate,id:'withdrawal-conflict',wallet_custody_transfers:[{...duplicate.wallet_custody_transfers[0],amount_cents:400000}]}),/different values/);
});
test('changed balances reject the withdrawal and roll back both sides',t=>{
 const f=fixture(t);f.config.wallet_balances[0].expected_balance_cents=1;
 assert.throws(()=>applyBankReview(f.db,f.config),/Wallet balance changed/);
 assert.equal(f.balance(),534795);assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='xavi-pichincha'").get().balance_cents,null);
 assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,0);
});
