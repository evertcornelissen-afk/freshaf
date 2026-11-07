package io.freshaf.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the sign-in token encrypted at rest with a key held by the Android Keystore, so the
 * person stays signed in across restarts, background kills and app updates without the
 * token sitting in plain app storage. native.js falls back to Preferences if this fails
 * (some phones have a broken keystore), so a storage problem never signs anyone out.
 */
@CapacitorPlugin(name = "TokenStore")
public class TokenStorePlugin extends Plugin {
    private static final String FILE = "freshaf_secure";
    private SharedPreferences prefs;

    private SharedPreferences prefs() throws Exception {
        if (prefs == null) {
            Context ctx = getContext();
            String masterKey = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            prefs = EncryptedSharedPreferences.create(FILE, masterKey, ctx,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        }
        return prefs;
    }

    @PluginMethod
    public void get(PluginCall call) {
        try {
            String key = call.getString("key", "");
            JSObject r = new JSObject();
            r.put("value", prefs().getString(key, null));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Secure storage unavailable", e);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        try {
            prefs().edit().putString(call.getString("key", ""), call.getString("value", "")).commit();
            call.resolve();
        } catch (Exception e) {
            call.reject("Secure storage unavailable", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            prefs().edit().remove(call.getString("key", "")).commit();
            call.resolve();
        } catch (Exception e) {
            call.reject("Secure storage unavailable", e);
        }
    }
}
