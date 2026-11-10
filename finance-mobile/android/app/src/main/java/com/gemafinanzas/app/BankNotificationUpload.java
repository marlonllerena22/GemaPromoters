package com.gemafinanzas.app;

import android.content.Context;
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
    static void enqueue(Context c){
        Constraints network=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest job=new OneTimeWorkRequest.Builder(BankNotificationUpload.class).setConstraints(network).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build();
        WorkManager.getInstance(c).enqueueUniqueWork("gema-bank-upload",ExistingWorkPolicy.APPEND_OR_REPLACE,job);
    }
    @NonNull @Override public Result doWork(){
        try{
            JSONObject state=BankNotificationStore.read(getApplicationContext());
            if(!state.optBoolean("enabled")||!state.has("token"))return Result.success();
            JSONArray queue=state.optJSONArray("queue"),batch=new JSONArray();
            if(queue==null||queue.length()==0)return Result.success();
            for(int i=0;i<Math.min(20,queue.length());i++)batch.put(queue.getJSONObject(i));
            HttpsURLConnection conn=(HttpsURLConnection)new URL("https://gemapromoters.onrender.com/api/finance/android-bank-events").openConnection();
            try{
                conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(20000);conn.setReadTimeout(30000);conn.setRequestMethod("POST");conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type","application/json");conn.setRequestProperty("X-Gema-Bank-Device",state.getString("token"));
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
