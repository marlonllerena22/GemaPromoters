import {financeDay,safeMember} from './finance-db.js';
import {isStoreStaff,isWarehouse,staffNames,profilePermissions} from '../../shared/finance-access.mjs';

export function initProfileAccess(db,{seedAccounts=Boolean(db.prepare("SELECT 1 FROM finance_members WHERE username='marlon' AND role='owner'").get())}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS finance_staff_schedule(day TEXT NOT NULL,employee TEXT NOT NULL,unit_id TEXT,worked INTEGER NOT NULL DEFAULT 0,updated_by TEXT NOT NULL,PRIMARY KEY(day,employee));`);
 if(!db.prepare('PRAGMA table_info(finance_accounts)').all().some(c=>c.name==='holder_key'))db.exec("ALTER TABLE finance_accounts ADD COLUMN holder_key TEXT");
 if(!seedAccounts)return;
 // Metadata only: unknown bank numbers and balances remain unverified. No bank movements.
 for(const bank of ['Pichincha','Produbanco','Pacífico']){
  if(db.prepare("SELECT id FROM finance_accounts WHERE holder_key='lili' AND bank=?").get(bank))continue;
  const existing=db.prepare("SELECT id FROM finance_accounts WHERE bank=? AND (lower(name) LIKE '%liliana%' OR lower(name) LIKE '%lili%')").all(bank);
  if(existing.length===1)db.prepare("UPDATE finance_accounts SET holder_key='lili' WHERE id=?").run(existing[0].id);
  else if(!existing.length){db.prepare("INSERT INTO finance_accounts(name,bank,kind,business_id,last_four,opening_cents,opening_date,active,holder_key) VALUES (?,?,'bank','marjorie','',0,?,1,'lili')").run('Liliana · '+bank+' · por completar',bank,financeDay());}
 }
 if(!db.prepare("SELECT id FROM finance_accounts WHERE holder_key='more-sur'").get())db.prepare("INSERT INTO finance_accounts(name,bank,kind,business_id,last_four,opening_cents,opening_date,active,holder_key) VALUES ('MORE Local SUR','Pichincha','bank','marjorie','',0,?,1,'more-sur')").run(financeDay());
}
export function profileForDay(db,member,day=financeDay()){
 let u=profilePermissions(member);if(!isStoreStaff(u))return u;
 const row=db.prepare('SELECT * FROM finance_staff_schedule WHERE day=? AND employee=?').get(day,staffNames[u.username]);
 const original=u.unit_ids||[];
 // Permanent staff retain their single store until scheduled; replacements need an explicit day.
 const units=row?(row.unit_id?[row.unit_id]:[]):original.length===1?original:[];
 return {...u,assigned_unit_ids:units,unit_ids:units.length?units:['__sin_jornada__'],shift_day:day,shift_pending:!row&&original.length!==1,shift_off:Boolean(row&&!row.unit_id),staff_name:staffNames[u.username]};
}
export function effectiveMember(db,raw){return profileForDay(db,safeMember(raw));}
export function restrictProfileRoute(user,path,method){
 if(isStoreStaff(user)&&/^\/(closings|cash\/confirm|payees|spaces|payment-requests)(\/|$)/.test(path))return false;
 if(!isWarehouse(user))return true;
 return /^\/(snapshot|logout|remember-device|security(?:\/.*)?|workflow(?:\/.*)?|spaces(?:\/.*)?|payments(?:\/.*)?|requests(?:\/.*)?|payees(?:\/.*)?|payment-requests(?:\/.*)?|quick\/register|evidence(?:\/.*)?)$/.test(path);
}
