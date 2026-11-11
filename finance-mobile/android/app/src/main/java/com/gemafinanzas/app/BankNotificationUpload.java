package com.gemafinanzas.app;

import android.content.Context;
import android.os.Build;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.ServiceInfo;
import androidx.core.app.NotificationCompat;
import androidx.annotation.NonNull;
import androidx.work.*;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class BankNotificationUpload extends Worker {
    public BankNotificationUpload(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
    @NonNull @Override public ForegroundInfo getForegroundInfo(){
        Context context=getApplicationContext();String channel="gema-bank-sync";
        if(Build.VERSION.SDK_INT>=26)((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(channel,"Sincronización bancaria",NotificationManager.IMPORTANCE_LOW));
        android.app.Notification notice=new NotificationCompat.Builder(context,channel).setSmallIcon(R.drawable.ic_stat_gema).setContentTitle("Gema Finanzas").setContentText("Sincronizando avisos bancarios").setOngoing(true).build();
        return new ForegroundInfo(3102,notice,Build.VERSION.SDK_INT>=29?ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC:0);
    }
    static void enqueue(Context c){
        Constraints network=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest.Builder builder=new OneTimeWorkRequest.Builder(BankNotificationUpload.class).setConstraints(network).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS);
        if(Build.VERSION.SDK_INT>=31)builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST);
        OneTimeWorkRequest job=builder.build();
        WorkManager.getInstance(c).enqueueUniqueWork("gema-bank-upload",ExistingWorkPolicy.APPEND_OR_REPLACE,job);
    }
    static void ensureMonitoring(Context c){
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("gema-bank-keepalive",ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(BankNotificationUpload.class,15,TimeUnit.MINUTES).build());
    }
    @NonNull @Override public Result doWork(){
        try{
            JSONObject state=BankNotificationStore.read(getApplicationContext());
            if(!state.optBoolean("enabled")||!state.has("token"))return Result.success();
            BankNotificationListener.recover(getApplicationContext());
            state=BankNotificationStore.read(getApplicationContext());
            if(!state.optBoolean("enabled")||!state.has("token"))return Result.success();
            JSONArray queue=state.optJSONArray("queue"),batch=new JSONArray();
            if(queue==null||queue.length()==0)return Result.success();
            for(int i=0;i<Math.min(20,queue.length());i++)batch.put(queue.getJSONObject(i));
            HttpsURLConnection conn=(HttpsURLConnection)new URL("https://gemapromoters.onrender.com/api/finance/android-bank-events").openConnection();
            try{
                conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(20000);conn.setReadTimeout(30000);conn.setRequestMethod("POST");conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type","application/json");conn.setRequestProperty("X-Finance-Request","1");conn.setRequestProperty("X-Gema-Bank-Device",state.getString("token"));
                byte[] bytes=new JSONObject().put("events",batch).toString().getBytes(StandardCharsets.UTF_8);conn.setFixedLengthStreamingMode(bytes.length);
                try(java.io.OutputStream stream=conn.getOutputStream()){stream.write(bytes);}
                int status=conn.getResponseCode();
                if(status==401||status==403){BankNotificationStore.rejectToken(getApplicationContext(),state.getString("token"));return Result.success();}
                if(status!=200){BankNotificationStore.error(getApplicationContext(),"upload_pending");return Result.retry();}
                byte[] result;
                try(java.io.InputStream stream=conn.getInputStream()){java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;while((count=stream.read(buffer))!=-1){output.write(buffer,0,count);if(output.size()>65536)break;}result=output.toByteArray();}
                if(result.length>65536)return Result.retry();
                JSONArray ack=new JSONObject(new String(result,StandardCharsets.UTF_8)).getJSONArray("ack");
                synchronized(BankNotificationStore.class){
                    JSONObject current=BankNotificationStore.read(getApplicationContext());
                    // Never let an old worker acknowledge a newer user's queue after logout/re-pair.
                    if(!state.optString("token").equals(current.optString("token")))return Result.success();
                    BankNotificationStore.ack(getApplicationContext(),ack);
                }
                if(queue.length()>batch.length())enqueue(getApplicationContext());
                return Result.success();
            }finally{conn.disconnect();}
        }catch(Exception ignored){BankNotificationStore.error(getApplicationContext(),"upload_pending");return Result.retry();}
    }
}
