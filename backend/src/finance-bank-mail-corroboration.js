// A phone notice starts mail corroboration immediately; no two-minute poll wait.
export function createBankMailCorroborator(db,{syncMail,matchNotifications,schedule=setTimeout}){
  let handled=0,running=false;
  const latest=()=>db.prepare("SELECT COALESCE(MAX(id),0) id FROM finance_notification_events WHERE state='review' AND archived_at IS NULL").get().id;
  const enqueue=(callback,delay)=>{const timer=schedule(callback,delay);timer?.unref?.();};
  async function run(attempt){
    try{
      await syncMail();
      matchNotifications();
    }catch(error){console.warn('[finance] Fast bank-mail corroboration will retry: '+(error.code||error.name));}
    if(latest()&&attempt<2){enqueue(()=>run(attempt+1),attempt===0?4000:15000);return;}
    running=false;
    request();
  }
  function request(){
    if(!db.prepare("SELECT 1 FROM finance_mail_oauth WHERE id='gmail'").get())return false;
    const id=latest();if(!id||id<=handled)return false;
    if(running)return true;
    handled=id;running=true;enqueue(()=>run(0),0);return true;
  }
  return request;
}
