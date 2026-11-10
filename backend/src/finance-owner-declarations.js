import crypto from "node:crypto";
import {safeMember,financeDay,audit} from "./finance-db.js";
import {encryptDocument} from "./finance-ai.js";
import {confirmConversation} from "./finance-conversation.js";
import {privateSetting,putPrivateSetting} from "./finance-operations.js";
import {recordedAccountBalance} from "./finance-check-ledger.js";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/banco|[^a-z0-9]/g,"");

export function recordOwnerDeclaration(db,entry,jobId){
  if(!entry.id || entry.day!==financeDay() || !entry.bank || !entry.account_name || entry.confirmed!==true)throw new Error("Invalid owner declaration");
  const accounts=db.prepare("SELECT * FROM finance_accounts WHERE active=1 AND kind='bank'").all().filter(a=>norm(a.bank)===norm(entry.bank)&&norm(a.name).includes(norm(entry.account_name)));
  if(accounts.length!==1)throw new Error("Declared account is ambiguous");
  const account=accounts[0],owner=safeMember(db.prepare("SELECT * FROM finance_members WHERE active=1 AND role='owner' ORDER BY id LIMIT 1").get());
  if(entry.card_suffix){
    if(!/^\d{4}$/.test(entry.card_suffix))throw new Error("Invalid card suffix");
    const mappings=privateSetting(db,"debit_card_accounts")||[];
    const old=mappings.find(m=>norm(m.bank)===norm(entry.bank)&&m.suffix===entry.card_suffix);
    if(old && old.account_id!==account.id)throw new Error("Existing debit card maps to another account");
    if(!old){mappings.push({bank:account.bank,suffix:entry.card_suffix,account_id:account.id});putPrivateSetting(db,"debit_card_accounts",mappings);}
  }
  const id=crypto.createHash("sha256").update(`owner-declaration:${entry.id}`).digest("hex"),now=new Date().toISOString();
  const data={business_id:entry.business_id,unit_id:null,account_id:account.id,amount_cents:entry.amount_cents,day:entry.day,category:entry.category,counterparty:entry.counterparty,description:entry.description,reference:entry.reference||null,custody_id:null,space_id:null,kind:"expense",direction:"outgoing",payment_method:entry.card_suffix?"card":"transfer"};
  const plan={action:"bank_entry",data,expected_balance:recordedAccountBalance(db,account)};
  db.prepare("INSERT OR IGNORE INTO finance_assistant_drafts VALUES (?,?,?,?,NULL,?)").run(id,owner.id,encryptDocument(Buffer.from(JSON.stringify(plan))),Date.now()+1200000,now);
  const result=confirmConversation(db,owner,{draft_id:id,confirmed:true});
  audit(db,"system:authorized-bank-review","owner.expense_declared","movement",result.movement_id,null,{job_id:jobId,declared_by_owner:true,bank_confirmation_pending:true},entry.business_id);
  return {movement_id:result.movement_id,bank_transaction_id:result.bank_transaction_id,balance_cents:recordedAccountBalance(db,account)};
}
