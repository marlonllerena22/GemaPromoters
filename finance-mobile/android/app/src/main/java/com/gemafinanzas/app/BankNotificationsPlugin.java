package com.gemafinanzas.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.*;

@CapacitorPlugin(name="BankNotifications")
public class BankNotificationsPlugin extends Plugin {
    static String certificate(Context c,String pkg) throws Exception {
        PackageManager pm=c.getPackageManager();
        PackageInfo info=pm.getPackageInfo(pkg,Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES);
        android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28?info.signingInfo.getApkContentsSigners():info.signatures;
        java.util.List<String> values=new ArrayList<>();
        for(android.content.pm.Signature signature:signatures)values.add(android.util.Base64.encodeToString(signature.toByteArray(),android.util.Base64.NO_WRAP));
        Collections.sort(values);return BankNotificationStore.hash(String.join(":",values));
    }
    private static long parseTime(String value) throws Exception {
        java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);format.setTimeZone(TimeZone.getTimeZone("UTC"));return format.parse(value).getTime();
    }
    private boolean allowed(){return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());}
    private void trusted() {
        String current;
        if(android.os.Looper.myLooper()==android.os.Looper.getMainLooper())current=getBridge().getWebView().getUrl();
        else{
            java.util.concurrent.FutureTask<String> task=new java.util.concurrent.FutureTask<>(()->getBridge().getWebView().getUrl());
            getActivity().runOnUiThread(task);
            try{current=task.get(3,java.util.concurrent.TimeUnit.SECONDS);}catch(Exception error){throw new SecurityException("Page unavailable");}
        }
        if(current==null||!current.startsWith("https://gemapromoters.onrender.com/finanzas/"))throw new SecurityException("Untrusted page");
    }
    @PluginMethod public void status(PluginCall call){
        try{trusted();JSONObject state=BankNotificationStore.read(getContext());
            if(state.optBoolean("enabled")&&state.has("token")&&allowed()){BankNotificationListener.recover(getContext());state=BankNotificationStore.read(getContext());}
            if(!state.has("client_id")){state.put("client_id",UUID.randomUUID().toString());BankNotificationStore.write(getContext(),state);}
            JSObject result=new JSObject();result.put("supported",true);result.put("permission",allowed());result.put("client_id",state.getString("client_id"));
            result.put("enabled",state.optBoolean("enabled"));result.put("paired",state.has("token"));result.put("device_id",state.optString("device_id"));result.put("owner_id",state.optInt("owner_id"));
            result.put("reader_version",2);result.put("listener_connected",BankNotificationListener.isConnected());
            result.put("queued",state.optJSONArray("queue")==null?0:state.getJSONArray("queue").length());result.put("last_capture",state.optLong("last_capture"));result.put("last_upload",state.optLong("last_upload"));result.put("error",state.optString("error"));
            call.resolve(result);
        }catch(Exception ignored){call.reject("No se pudo consultar el acceso de Android");}
    }
    @PluginMethod public void apps(PluginCall call){
        try{trusted();Intent launcher=new Intent(Intent.ACTION_MAIN);launcher.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> installed=getContext().getPackageManager().queryIntentActivities(launcher,0);Map<String,String> unique=new TreeMap<>();
            for(ResolveInfo app:installed){String pkg=app.activityInfo.packageName,label=app.loadLabel(getContext().getPackageManager()).toString();
                String search=(label+" "+pkg).toLowerCase(Locale.ROOT);
                if(search.matches(".*(?:pichincha|guayaquil|pacifico|pacífico|pacificard|produbanco|solidario|deuna|de una).*"))unique.put(pkg,label);}
            JSArray apps=new JSArray();for(Map.Entry<String,String> app:unique.entrySet())apps.put(new JSONObject().put("package_name",app.getKey()).put("label",app.getValue()));
            call.resolve(new JSObject().put("apps",apps));
        }catch(Exception ignored){call.reject("No se pudo consultar las apps bancarias instaladas");}
    }
    @PluginMethod public void settings(PluginCall call){
        try{trusted();getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));call.resolve();}
        catch(Exception ignored){call.reject("Abre Ajustes de Android → Acceso a notificaciones → Gema");}
    }
    @PluginMethod public void configure(PluginCall call){
        try{trusted();String token=call.getString("token"),device=call.getString("device_id"),start=call.getString("started_at");JSArray apps=call.getArray("apps");
            if(token==null||!token.matches("[a-f0-9]{64}")||apps==null||apps.length()<1||apps.length()>12)throw new IllegalArgumentException();
            synchronized(BankNotificationStore.class){
                JSONObject state=BankNotificationStore.read(getContext());JSONArray selected=new JSONArray();Set<String> packages=new HashSet<>();
                for(int i=0;i<apps.length();i++){JSONObject app=apps.getJSONObject(i);String pkg=app.getString("package_name");packages.add(pkg);selected.put(new JSONObject().put("package_name",pkg).put("certificate",certificate(getContext(),pkg)));}
                JSONArray old=state.optJSONArray("queue"),queue=new JSONArray();
                if(old!=null)for(int i=0;i<old.length();i++)if(packages.contains(old.getJSONObject(i).optString("package_name")))queue.put(old.getJSONObject(i));
                state.put("token",token).put("device_id",device).put("started_at",parseTime(start)).put("apps",selected).put("queue",queue).put("enabled",true).put("owner_id",call.getInt("owner_id",0)).put("error","");
                BankNotificationStore.write(getContext(),state);
            }
            android.service.notification.NotificationListenerService.requestRebind(new ComponentName(getContext(),BankNotificationListener.class));
            BankNotificationUpload.ensureMonitoring(getContext());BankNotificationListener.recover(getContext());BankNotificationUpload.enqueue(getContext());call.resolve();
        }catch(Exception ignored){call.reject("No se pudo conectar la lectura de bancos en este celular");}
    }
    @PluginMethod public void stop(PluginCall call){
        try{trusted();BankNotificationStore.stop(getContext());androidx.work.WorkManager.getInstance(getContext()).cancelUniqueWork("gema-bank-upload");androidx.work.WorkManager.getInstance(getContext()).cancelUniqueWork("gema-bank-keepalive");call.resolve();}
        catch(Exception ignored){call.reject("No se pudo detener el acceso bancario");}
    }
}
