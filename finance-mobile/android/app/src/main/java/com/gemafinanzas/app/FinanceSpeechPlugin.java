package com.gemafinanzas.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.ArrayList;

@CapacitorPlugin(name="FinanceSpeech", permissions={@Permission(alias="microphone", strings={Manifest.permission.RECORD_AUDIO})})
public class FinanceSpeechPlugin extends Plugin {
    @PluginMethod public void start(PluginCall call) {
        if(getPermissionState("microphone")!=PermissionState.GRANTED) {
            requestPermissionForAlias("microphone",call,"microphoneResult");
            return;
        }
        recognize(call);
    }
    @PermissionCallback private void microphoneResult(PluginCall call) {
        if(getPermissionState("microphone")!=PermissionState.GRANTED) {
            call.reject("Activa Micrófono en Ajustes → Aplicaciones → Gema Finanzas → Permisos.","MICROPHONE_DENIED");
            return;
        }
        recognize(call);
    }
    private void recognize(PluginCall call) {
        Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"es-EC");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT,"Cuéntale a Gema qué quieres registrar");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
        try { startActivityForResult(call,intent,"speechResult"); }
        catch(ActivityNotFoundException e) { call.reject("Activa el reconocimiento de voz de Google o usa el micrófono de tu teclado.","SPEECH_UNAVAILABLE"); }
    }
    @ActivityCallback private void speechResult(PluginCall call,ActivityResult result) {
        if(call==null)return;
        ArrayList<String> matches=result.getResultCode()==Activity.RESULT_OK&&result.getData()!=null
            ?result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS):null;
        String text=matches==null||matches.isEmpty()?"":matches.get(0).trim();
        call.resolve(new JSObject().put("text",text).put("cancelled",text.isEmpty()));
    }
}
