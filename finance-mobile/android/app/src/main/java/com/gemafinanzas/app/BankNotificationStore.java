package com.gemafinanzas.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

// No plaintext financial notifications or upload credential on disk or in logs.
final class BankNotificationStore {
    private static final String ALIAS="gema.bank.notifications.v1";
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return gen.generateKey();
    }
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("gema_bank_encrypted",Context.MODE_PRIVATE);}
    static synchronized JSONObject read(Context c) throws Exception {
        String value=prefs(c).getString("sealed",null);if(value==null)return new JSONObject();
        byte[] data=Base64.decode(value,Base64.NO_WRAP);if(data.length<29)throw new IllegalStateException("Invalid private state");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,java.util.Arrays.copyOf(data,12)));
        return new JSONObject(new String(cipher.doFinal(data,12,data.length-12),StandardCharsets.UTF_8));
    }
    static synchronized void write(Context c,JSONObject data) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] sealed=cipher.doFinal(data.toString().getBytes(StandardCharsets.UTF_8)),iv=cipher.getIV();
        byte[] combined=new byte[iv.length+sealed.length];System.arraycopy(iv,0,combined,0,iv.length);System.arraycopy(sealed,0,combined,iv.length,sealed.length);
        if(!prefs(c).edit().putString("sealed",Base64.encodeToString(combined,Base64.NO_WRAP)).commit())throw new IllegalStateException("Private state not saved");
    }
    static String hash(String value) throws Exception {
        byte[] result=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder out=new StringBuilder();for(byte b:result)out.append(String.format(java.util.Locale.ROOT,"%02x",b));return out.toString();
    }
    static synchronized void stop(Context c) throws Exception {
        JSONObject state=read(c);String client=state.optString("client_id",java.util.UUID.randomUUID().toString());
        write(c,new JSONObject().put("client_id",client));
    }
    static synchronized void ack(Context c,JSONArray ids) throws Exception {
        JSONObject state=read(c);JSONArray queue=state.optJSONArray("queue"),kept=new JSONArray();
        java.util.Set<String> accepted=new java.util.HashSet<>();for(int i=0;i<ids.length();i++)accepted.add(ids.getString(i));
        JSONArray delivered=state.optJSONArray("delivered_ids");if(delivered==null)delivered=new JSONArray();
        java.util.Set<String> known=new java.util.HashSet<>();for(int i=0;i<delivered.length();i++)known.add(delivered.optString(i));
        for(String id:accepted)if(known.add(id))delivered.put(id);
        JSONArray recent=new JSONArray();for(int i=Math.max(0,delivered.length()-1000);i<delivered.length();i++)recent.put(delivered.getString(i));
        state.put("delivered_ids",recent);
        if(queue!=null)for(int i=0;i<queue.length();i++){JSONObject e=queue.getJSONObject(i);if(!accepted.contains(e.getString("id")))kept.put(e);}
        state.put("queue",kept).put("last_upload",System.currentTimeMillis()).put("error","");write(c,state);
    }
    static synchronized void error(Context c,String code) {
        try{JSONObject state=read(c);state.put("error",code);if(code.equals("reconnect"))state.remove("token");write(c,state);}catch(Exception ignored){}
    }
    static synchronized void rejectToken(Context c,String token) {
        try{if(token.equals(read(c).optString("token")))error(c,"reconnect");}catch(Exception ignored){}
    }
}
