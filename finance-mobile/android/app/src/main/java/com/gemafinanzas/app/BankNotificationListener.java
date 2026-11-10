package com.gemafinanzas.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Locale;

public class BankNotificationListener extends NotificationListenerService {
    static boolean sensitive(String text){
        String plain=Normalizer.normalize(text,Normalizer.Form.NFD).replaceAll("\\p{M}","").toLowerCase(Locale.ROOT);
        return plain.matches("(?s).*\\b(?:otp|clave|contrasena)\\b.*") || plain.contains("codigo")
            || plain.contains("inicio de sesion") || plain.contains("verificacion de acceso") || plain.contains("verificar tu identidad");
    }
    private static String utc(long value){
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));return format.format(new java.util.Date(value));
    }
    @Override public void onListenerConnected(){BankNotificationUpload.enqueue(this);}
    @Override public void onNotificationPosted(StatusBarNotification sbn){
        if(sbn==null || (sbn.getNotification().flags&Notification.FLAG_GROUP_SUMMARY)!=0)return;
        try{
            synchronized(BankNotificationStore.class){
                JSONObject state=BankNotificationStore.read(this);
                if(!state.optBoolean("enabled")||!state.has("token"))return;
                JSONArray apps=state.optJSONArray("apps");JSONObject selected=null;
                if(apps!=null)for(int i=0;i<apps.length();i++)if(apps.getJSONObject(i).optString("package_name").equals(sbn.getPackageName()))selected=apps.getJSONObject(i);
                if(selected==null || sbn.getPostTime()<state.optLong("started_at",Long.MAX_VALUE))return;
                // Check the certificate pinned when the owner selected the installed app.
                if(!BankNotificationsPlugin.certificate(this,sbn.getPackageName()).equals(selected.optString("certificate"))){BankNotificationStore.error(this,"app_changed");return;}
                Bundle extra=sbn.getNotification().extras;
                String title=String.valueOf(extra.getCharSequence(Notification.EXTRA_TITLE,""));
                CharSequence big=extra.getCharSequence(Notification.EXTRA_BIG_TEXT);String text=String.valueOf(big!=null?big:extra.getCharSequence(Notification.EXTRA_TEXT,""));
                if(title.length()>1000||text.length()>4500||sensitive(title+" "+text)||text.trim().isEmpty())return;
                JSONArray queue=state.optJSONArray("queue");if(queue==null)queue=new JSONArray();
                String id=BankNotificationStore.hash(sbn.getKey()+":"+sbn.getPostTime());
                for(int i=0;i<queue.length();i++)if(id.equals(queue.getJSONObject(i).getString("id")))return;
                if(queue.length()>=500){state.put("error","queue_full");BankNotificationStore.write(this,state);return;}
                queue.put(new JSONObject().put("id",id).put("package_name",sbn.getPackageName()).put("posted_at",utc(sbn.getPostTime())).put("title",title).put("text",text));
                state.put("queue",queue).put("last_capture",System.currentTimeMillis());BankNotificationStore.write(this,state);
            }
            BankNotificationUpload.enqueue(this);
        }catch(Exception ignored){BankNotificationStore.error(this,"capture_error");}
    }
}
