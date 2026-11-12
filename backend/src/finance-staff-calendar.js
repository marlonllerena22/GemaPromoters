import {audit,financeDay,validDay} from './finance-db.js';
import {fail} from './finance-service.js';
import {RETAIL_STORES,RETAIL_STAFF,retailEditor} from '../../shared/finance-retail.mjs';
import {retailAttendance,retailPeriod} from './finance-retail.js';

export function saveStaffSchedule(db,user,body){
 if(!retailEditor(user))fail('Solo Marlon y Morelia organizan la asistencia',403);
 const day=validDay(body.day),employee=body.employee,unit=body.unit_id||null,worked=body.worked===true;
 if(!RETAIL_STAFF.includes(employee)||unit&&!RETAIL_STORES[unit])fail('Selecciona empleada y local');
 if(worked&&(day>financeDay()||!unit))fail('Solo marca trabajadas jornadas ya realizadas');
 return db.transaction(()=>{
  const old=db.prepare('SELECT * FROM finance_staff_schedule WHERE day=? AND employee=?').get(day,employee);
  db.prepare('INSERT INTO finance_staff_schedule VALUES (?,?,?,?,?) ON CONFLICT(day,employee) DO UPDATE SET unit_id=excluded.unit_id,worked=excluded.worked,updated_by=excluded.updated_by').run(day,employee,unit,worked?1:0,user.username);
  if(day<=financeDay()){
   const previous=db.prepare('SELECT * FROM finance_retail_attendance WHERE day=? AND employee=?').all(day,employee);
   for(const p of previous)retailAttendance(db,user,{...p,weight:0});
   if(worked)retailAttendance(db,user,{day,employee,unit_id:unit,weight:1});
  }
  audit(db,user.username,'retail.schedule','staff_schedule',day+employee,old,{day,employee,unit_id:unit,worked},'marjorie');return {ok:true};
 })();
}
export function registerStaffCalendar(app,db,{route}){
 app.get('/api/finance/retail/calendar',route((req,res)=>{if(!retailEditor(req.financeUser))fail('Calendario de organización',403);const period=retailPeriod({day:req.query.day,mode:'month'});res.json({period,staff:RETAIL_STAFF,stores:RETAIL_STORES,entries:db.prepare('SELECT * FROM finance_staff_schedule WHERE day BETWEEN ? AND ? ORDER BY day,employee').all(period.from,period.to)});}));
 app.post('/api/finance/retail/calendar',route((req,res)=>res.json(saveStaffSchedule(db,req.financeUser,req.body))));
}
