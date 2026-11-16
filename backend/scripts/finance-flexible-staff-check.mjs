// Isolated mobile regression. Does not access production or real bank balances.
import fs from 'node:fs';import express from 'express';import Database from 'better-sqlite3';import assert from 'node:assert/strict';
import {chromium} from '../data/ui-tools/node_modules/playwright/index.mjs';
import {initFinanceDb,financeDay,passwordHash} from '../src/finance-db.js';import {seedFinanceDemo} from '../src/finance-demo.js';import {registerFinanceRoutes} from '../src/finance-routes.js';
import {YAJAIRA_UNITS} from '../../shared/finance-access.mjs';
process.env.NODE_ENV='test';process.env.FINANCE_DEMO='0';process.env.FINANCE_INTERNAL_SYNC_ENABLED='0';delete process.env.OPENAI_API_KEY;delete process.env.FINANCE_ADMIN_PASSWORD;
const db=new Database(':memory:');initFinanceDb(db);seedFinanceDemo(db);const app=express();app.use(express.json());registerFinanceRoutes(app,db);app.use(express.static('frontend/dist'));app.get('/finanzas/*',(_,r)=>r.sendFile(process.cwd()+'/frontend/dist/index.html'));const server=app.listen(4204,'127.0.0.1');
db.prepare('INSERT INTO finance_members(name,username,password_hash,role,business_ids,unit_ids) VALUES (?,?,?,?,?,?)').run('Yajaira','yajaira',passwordHash('Fixture8'),'collector','["marjorie"]',JSON.stringify(YAJAIRA_UNITS));
const browser=await chromium.launch({headless:true,executablePath:process.env.FINANCE_QA_CHROME||(fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined)}),base='http://127.0.0.1:4204',out='backend/data/ux-audit/yajaira';fs.mkdirSync(out,{recursive:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 assert.equal((await context.request.post(base+'/api/finance/login',{headers:{'X-Finance-Request':'1'},data:{username:'yajaira',password:'Fixture8'}})).status(),200);
 await page.goto(base+'/finanzas/');await page.getByLabel('Local de hoy').waitFor();
 assert.deepEqual(await page.getByLabel('Local de hoy').locator('option').allTextContents(),['Selecciona el local','Norte','Valle','Sur']);
 assert.equal(await page.getByRole('button',{name:'Llegué',exact:true}).isEnabled(),false);
 assert.equal(await page.getByRole('button',{name:/Registrar gasto/}).isEnabled(),false);
 assert.equal(await page.getByRole('button',{name:/Pedir transferencia|Pedir pago/}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/choose-store.png',fullPage:true});
 await page.getByLabel('Local de hoy').selectOption('marjorie-norte');await page.getByRole('button',{name:'Llegué',exact:true}).click();
 await page.getByRole('button',{name:/Registrar gasto/}).waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Registrar gasto')&&!b.disabled));
 assert.equal(await page.getByLabel('Local de hoy').count(),0);
 const snap=await(await context.request.get(base+'/api/finance/snapshot')).json();assert.deepEqual(snap.user.unit_ids,['marjorie-norte']);assert.equal(snap.accounts.length,0);assert.equal(snap.user.request_payments,false);assert.equal(snap.user.store_cash_visible,false);
 assert.equal((await context.request.post(base+'/api/finance/quick/register',{headers:{'X-Finance-Request':'1'},data:{request:true,text:'Pide pagar $10',request_id:'fixture-yajaira-denied'}})).status(),403);
 await page.getByRole('button',{name:/Registrar gasto/}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Concepto',{exact:true}).selectOption('servientrega');await dialog.getByLabel('Valor en dólares',{exact:true}).fill('4.25');await dialog.getByLabel('Proveedor / responsable').fill('Servientrega');await dialog.getByLabel('Descripción u observación').fill('Prueba aislada Yajaira');await dialog.getByRole('button',{name:'Confirmar y guardar',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(db.prepare('SELECT unit_id FROM finance_retail_entries WHERE description=?').get('Prueba aislada Yajaira').unit_id,'marjorie-norte');
 await page.getByRole('button',{name:/Subir transferencia de cliente/}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.locator('input[type=file]').count(),2);await dialog.getByRole('button',{name:'Cerrar ventana'}).click();
 await page.getByRole('button',{name:'Salí',exact:true}).click();await page.getByText('Jornada registrada',{exact:false}).waitFor();assert.equal(db.prepare('SELECT weight FROM finance_retail_attendance WHERE employee=? AND day=?').get('Yajaira',financeDay()).weight,1);
 await page.screenshot({path:out+'/assigned-norte.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: Yajaira mobile store choice, attendance, expenses, camera/upload, privacy, request denial and no browser errors');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
