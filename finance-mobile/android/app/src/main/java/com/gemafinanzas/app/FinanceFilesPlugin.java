package com.gemafinanzas.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="FinanceFiles")
public class FinanceFilesPlugin extends Plugin {
    private byte[] bytes(PluginCall call){
        String text=call.getString("data","");if(text.length()>8500000)throw new IllegalArgumentException();
        byte[] data=android.util.Base64.decode(text,android.util.Base64.DEFAULT);if(data.length>6*1024*1024)throw new IllegalArgumentException();return data;
    }
    private void write(PluginCall call,Uri uri) throws Exception {
        try(java.io.OutputStream stream=getContext().getContentResolver().openOutputStream(uri)){if(stream==null)throw new java.io.IOException();stream.write(bytes(call));}
    }
    @PluginMethod public void save(PluginCall call){
        Uri uri=null;
        try{
            String name=call.getString("name","comprobante").replaceAll("[^a-zA-Z0-9._-]","_");if(name.length()>120)name=name.substring(0,120);
            String mime=call.getString("mime","");if(!java.util.Arrays.asList("image/jpeg","image/png","image/webp","application/pdf","text/csv").contains(mime))throw new IllegalArgumentException();
            bytes(call);
            if(Build.VERSION.SDK_INT>=29){
                ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);values.put(MediaStore.MediaColumns.MIME_TYPE,mime);values.put(MediaStore.MediaColumns.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/Gema Finanzas");values.put(MediaStore.MediaColumns.IS_PENDING,1);
                uri=getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new java.io.IOException();write(call,uri);
                ContentValues ready=new ContentValues();ready.put(MediaStore.MediaColumns.IS_PENDING,0);getContext().getContentResolver().update(uri,ready,null,null);
                call.resolve(new JSObject().put("saved",true).put("location","Descargas / Gema Finanzas"));
            }else{
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(call,intent,"saveResult");
            }
        }catch(Exception ignored){if(uri!=null)getContext().getContentResolver().delete(uri,null,null);call.reject("No se pudo guardar el archivo en Descargas");}
    }
    @ActivityCallback private void saveResult(PluginCall call,ActivityResult result){
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){call.resolve(new JSObject().put("saved",false));return;}
        try{write(call,result.getData().getData());call.resolve(new JSObject().put("saved",true).put("location","Carpeta elegida"));}catch(Exception ignored){call.reject("No se pudo guardar el comprobante");}
    }
}
