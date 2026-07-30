package app.delicoop101.posapi;

import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v2.11.27: Capacitor wrapper for the vendor POS SDK.
 * Every method dispatches to PosApi on a dedicated background thread —
 * JNI calls into libPosApi.so are not main-thread safe.
 */
@CapacitorPlugin(name = "PosApi")
public class PosApiPlugin extends Plugin {

    private static final String TAG = "PosApiPlugin";
    private HandlerThread worker;
    private Handler handler;

    @Override
    public void load() {
        worker = new HandlerThread("PosApiWorker");
        worker.start();
        handler = new Handler(worker.getLooper());
        run(() -> {
            try {
                PosApi.Result r = PosApi.get().appInit(getContext());
                Log.i(TAG, "Lib_AppInit rc=" + r.rc + " code=" + r.code + " msg=" + r.message);
            } catch (Throwable t) {
                Log.e(TAG, "load() init failed: " + t.getMessage(), t);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        try { if (worker != null) worker.quitSafely(); } catch (Throwable ignored) {}
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------- system
    @PluginMethod public void beep(PluginCall c)          { run(() -> respond(c, PosApi.get().beep())); }
    @PluginMethod public void powerOn(PluginCall c)       { run(() -> respond(c, PosApi.get().powerOn())); }
    @PluginMethod public void powerOff(PluginCall c)      { run(() -> respond(c, PosApi.get().powerOff())); }
    @PluginMethod public void getVersion(PluginCall c)    { run(() -> respond(c, PosApi.get().getVersion())); }
    @PluginMethod public void getSerial(PluginCall c)     { run(() -> respond(c, PosApi.get().getSerial())); }
    @PluginMethod public void getChipId(PluginCall c)     { run(() -> respond(c, PosApi.get().getChipId())); }
    @PluginMethod public void getTime(PluginCall c)       { run(() -> respond(c, PosApi.get().getTime())); }
    @PluginMethod public void setTime(PluginCall c) {
        String t = c.getString("value");
        if (t == null) { c.reject("INVALID_ARGUMENT", "value required (YYYYMMDDHHMMSS)"); return; }
        run(() -> respond(c, PosApi.get().setTime(t)));
    }
    @PluginMethod public void setLog(PluginCall c) {
        int on = c.getInt("on", 1);
        run(() -> respond(c, PosApi.get().logSwitch(on)));
    }
    @PluginMethod public void setLed(PluginCall c) {
        int idx = c.getInt("index", 0);
        int st  = c.getInt("state", 0);
        run(() -> respond(c, PosApi.get().setLed(idx, st)));
    }
    @PluginMethod public void setEntryMode(PluginCall c) {
        boolean open = c.getBoolean("open", true);
        run(() -> respond(c, open ? PosApi.get().setEntryModeOpen() : PosApi.get().setEntryModeClose()));
    }

    // ------------------------------------------------------------- printer
    @PluginMethod public void initializePrinter(PluginCall c) {
        run(() -> {
            PosApi.Result r = PosApi.get().printOpen();
            if (r.code != null) { respond(c, r); return; }
            respond(c, PosApi.get().printInit(2, 24, 24, 0));
        });
    }
    @PluginMethod public void printText(PluginCall c) {
        String text = c.getString("text");
        if (text == null) { c.reject("INVALID_ARGUMENT", "text required"); return; }
        run(() -> respond(c, PosApi.get().printStr(text)));
    }
    @PluginMethod public void startPrint(PluginCall c) {
        run(() -> respond(c, PosApi.get().printStart()));
    }
    @PluginMethod public void printReceipt(PluginCall c) {
        JSArray arr = c.getArray("lines");
        if (arr == null) { c.reject("INVALID_ARGUMENT", "lines[] required"); return; }
        String[] lines;
        try {
            lines = new String[arr.length()];
            for (int i = 0; i < arr.length(); i++) lines[i] = arr.getString(i);
        } catch (Throwable t) {
            c.reject("INVALID_ARGUMENT", "lines must be string[]");
            return;
        }
        // v2.11.30: optional geometry so the CS10 receipt font/feed can be tuned
        // from JS without another native build. Defaults preserve callers.
        final int fontHeight = c.getInt("fontHeight", PosApi.DEFAULT_FONT_HEIGHT);
        final int fontWidth  = c.getInt("fontWidth",  PosApi.DEFAULT_FONT_WIDTH);
        final int lineSpace  = c.getInt("lineSpace",  PosApi.DEFAULT_LINE_SPACE);
        final int feedDots   = c.getInt("feedDots",   PosApi.DEFAULT_FEED_DOTS);
        final String[] payload = lines;
        run(() -> respond(c, PosApi.get().printReceipt(payload, fontHeight, fontWidth, lineSpace, feedDots)));
    }
    @PluginMethod public void closePrinter(PluginCall c) {
        // SDK has no explicit close — resolve ok. Kept for API symmetry.
        JSObject out = new JSObject().put("ok", true);
        c.resolve(out);
    }
    @PluginMethod public void printerStatus(PluginCall c) {
        run(() -> respond(c, PosApi.get().printerStatus()));
    }
    /**
     * v2.11.29: isReady now runs on the POS worker thread like every other
     * method (it performs a live JNI version probe — never do that on the UI
     * thread, it was a measured source of skipped frames), probes once instead
     * of twice, retries a pending Lib_AppInit, and always returns structured
     * detail so the JS side can never log an empty reason.
     */
    @PluginMethod public void isReady(PluginCall c) {
        run(() -> {
            PosApi api = PosApi.get();
            if (!api.isAppInitDone()) {
                // load() dispatches appInit asynchronously; a probe can land first.
                PosApi.Result init = api.appInit(getContext());
                Log.i(TAG, "isReady: re-ran appInit rc=" + init.rc + " code=" + init.code);
            }
            boolean ready = api.isReady();
            JSObject out = new JSObject()
                .put("ok", true)
                .put("ready", ready)
                .put("state", api.initState());
            String err = api.initErrorText();
            if (err != null) out.put("error", err);
            if (!ready && err == null) {
                out.put("error", "POS SDK not ready (state=" + api.initState() + ")");
            }
            c.resolve(out);
        });
    }


    // ------------------------------------------------------------- ICC
    @PluginMethod public void openCard(PluginCall c)   { run(() -> respond(c, PosApi.get().iccOpen())); }
    @PluginMethod public void closeCard(PluginCall c)  { run(() -> respond(c, PosApi.get().iccClose())); }
    @PluginMethod public void checkCard(PluginCall c)  { run(() -> respond(c, PosApi.get().iccCheck())); }
    @PluginMethod public void sendApdu(PluginCall c) {
        String mode = c.getString("mode", "icc"); // "icc" | "picc"
        byte[] apdu = decodeBytes(c.getString("apdu"));
        if (apdu == null) { c.reject("INVALID_ARGUMENT", "apdu (base64 or hex) required"); return; }
        run(() -> respond(c, "picc".equalsIgnoreCase(mode) ? PosApi.get().piccCommand(apdu) : PosApi.get().iccCommand(apdu)));
    }

    // ------------------------------------------------------------- NFC / PICC
    @PluginMethod public void openNfc(PluginCall c)    { run(() -> respond(c, PosApi.get().piccOpen())); }
    @PluginMethod public void closeNfc(PluginCall c)   { run(() -> respond(c, PosApi.get().piccClose())); }
    @PluginMethod public void detectCard(PluginCall c) { run(() -> respond(c, PosApi.get().piccCheck())); }
    @PluginMethod public void removeCard(PluginCall c) { run(() -> respond(c, PosApi.get().piccRemove())); }
    @PluginMethod public void resetCard(PluginCall c)  { run(() -> respond(c, PosApi.get().piccReset())); }
    @PluginMethod public void entryPoint(PluginCall c) { run(() -> respond(c, PosApi.get().entryPoint())); }

    // ------------------------------------------------------------- MSR
    @PluginMethod public void openMag(PluginCall c)  { run(() -> respond(c, PosApi.get().mcrOpen())); }
    @PluginMethod public void closeMag(PluginCall c) { run(() -> respond(c, PosApi.get().mcrClose())); }
    @PluginMethod public void resetMag(PluginCall c) { run(() -> respond(c, PosApi.get().mcrReset())); }
    @PluginMethod public void checkMag(PluginCall c) { run(() -> respond(c, PosApi.get().mcrCheck())); }
    @PluginMethod public void readMagStripe(PluginCall c) { run(() -> respond(c, PosApi.get().mcrRead())); }

    // ------------------------------------------------------------- Scanner
    @PluginMethod public void openScanner(PluginCall c)  { run(() -> respond(c, PosApi.get().scanOpen())); }
    @PluginMethod public void closeScanner(PluginCall c) { run(() -> respond(c, PosApi.get().scanClose())); }
    @PluginMethod public void scan(PluginCall c) {
        int timeout = c.getInt("timeoutMs", 10000);
        run(() -> respond(c, PosApi.get().scanRead(timeout)));
    }

    // ------------------------------------------------------------- PIN Pad
    @PluginMethod public void setTimeout(PluginCall c) {
        int s = c.getInt("seconds", 30);
        run(() -> respond(c, PosApi.get().setPadTimeout(s)));
    }
    @PluginMethod public void setPinType(PluginCall c) {
        int t = c.getInt("type", 0);
        run(() -> respond(c, PosApi.get().setPinType(t)));
    }
    @PluginMethod public void enterPin(PluginCall c) {
        run(() -> respond(c, PosApi.get().callKeyPad()));
    }
    @PluginMethod public void getPinBlock(PluginCall c) {
        String pan = c.getString("pan");
        boolean klk = c.getBoolean("klk", false);
        if (pan == null) { c.reject("INVALID_ARGUMENT", "pan required"); return; }
        run(() -> respond(c, klk ? PosApi.get().getKlkPinBlock(pan) : PosApi.get().getPinBlock(pan)));
    }

    // ------------------------------------------------------------- EMV
    @PluginMethod public void initEmv(PluginCall c)            { run(() -> respond(c, PosApi.get().emvInit())); }
    @PluginMethod public void startTransaction(PluginCall c)   { run(() -> respond(c, PosApi.get().emvProcess())); }
    @PluginMethod public void completeTransaction(PluginCall c) {
        int online = c.getInt("online", 0);
        run(() -> respond(c, PosApi.get().emvFinal(online)));
    }
    @PluginMethod public void getEmvVersion(PluginCall c)      { run(() -> respond(c, PosApi.get().emvGetVersion())); }
    @PluginMethod public void setAmount(PluginCall c) {
        Long amt = c.getLong("amount");
        if (amt == null) { c.reject("INVALID_ARGUMENT", "amount required"); return; }
        run(() -> respond(c, PosApi.get().emvSetAmount(amt)));
    }
    @PluginMethod public void setTransactionType(PluginCall c) {
        int t = c.getInt("type", 0);
        run(() -> respond(c, PosApi.get().emvSetTransType(t)));
    }
    @PluginMethod public void setCardType(PluginCall c) {
        int t = c.getInt("type", 0);
        run(() -> respond(c, PosApi.get().emvSetCardType(t)));
    }
    @PluginMethod public void setOnlineResult(PluginCall c) {
        int r = c.getInt("result", 0);
        run(() -> respond(c, PosApi.get().emvSetOnlineResult(r)));
    }
    @PluginMethod public void prepareField55(PluginCall c) { run(() -> respond(c, PosApi.get().emvPrepare55Field())); }
    @PluginMethod public void getTag(PluginCall c) {
        Integer tag = c.getInt("tag");
        if (tag == null) { c.reject("INVALID_ARGUMENT", "tag required"); return; }
        run(() -> respond(c, PosApi.get().emvGetTag(tag)));
    }
    @PluginMethod public void loadAid(PluginCall c) {
        byte[] aid = decodeBytes(c.getString("data"));
        if (aid == null) { c.reject("INVALID_ARGUMENT", "data (base64/hex) required"); return; }
        run(() -> respond(c, PosApi.get().emvAddAid(aid)));
    }
    @PluginMethod public void loadCapk(PluginCall c) {
        byte[] capk = decodeBytes(c.getString("data"));
        if (capk == null) { c.reject("INVALID_ARGUMENT", "data (base64/hex) required"); return; }
        run(() -> respond(c, PosApi.get().emvAddCapk(capk)));
    }
    @PluginMethod public void saveTermParas(PluginCall c) {
        byte[] p = decodeBytes(c.getString("data"));
        if (p == null) { c.reject("INVALID_ARGUMENT", "data required"); return; }
        run(() -> respond(c, PosApi.get().emvSaveTermParas(p)));
    }
    @PluginMethod public void clearAllAids(PluginCall c)  { run(() -> respond(c, PosApi.get().emvClearAllAids())); }
    @PluginMethod public void clearAllCapks(PluginCall c) { run(() -> respond(c, PosApi.get().emvClearAllCapks())); }

    // ------------------------------------------------------------- Fingerprint
    @PluginMethod public void openFingerprint(PluginCall c)    { run(() -> respond(c, PosApi.get().fpOpen())); }
    @PluginMethod public void closeFingerprint(PluginCall c)   { run(() -> respond(c, PosApi.get().fpClose())); }
    @PluginMethod public void captureFingerprint(PluginCall c) {
        int id = c.getInt("id", 1);
        run(() -> respond(c, PosApi.get().fpRegister(id)));
    }
    @PluginMethod public void matchFingerprint(PluginCall c)   { run(() -> respond(c, PosApi.get().fpMatch())); }
    @PluginMethod public void getFingerprintCode(PluginCall c) { run(() -> respond(c, PosApi.get().fpCode())); }
    @PluginMethod public void deleteFingerprints(PluginCall c) { run(() -> respond(c, PosApi.get().fpDeleteAll())); }

    // ------------------------------------------------------------- ID Card
    @PluginMethod public void openIdReader(PluginCall c)  { run(() -> respond(c, PosApi.get().idOpen())); }
    @PluginMethod public void closeIdReader(PluginCall c) { run(() -> respond(c, PosApi.get().idClose())); }
    @PluginMethod public void readId(PluginCall c) {
        boolean v2 = c.getBoolean("withFingerprint", false);
        run(() -> respond(c, v2 ? PosApi.get().idRead2() : PosApi.get().idRead()));
    }

    // ------------------------------------------------------------- Serial
    @PluginMethod public void send(PluginCall c) {
        int port = c.getInt("port", 0);
        byte[] data = decodeBytes(c.getString("data"));
        if (data == null) { c.reject("INVALID_ARGUMENT", "data required"); return; }
        run(() -> respond(c, PosApi.get().serialSend(port, data)));
    }
    @PluginMethod public void receive(PluginCall c) {
        int port    = c.getInt("port", 0);
        int max     = c.getInt("max", 512);
        int timeout = c.getInt("timeoutMs", 2000);
        run(() -> respond(c, PosApi.get().serialRecv(port, max, timeout)));
    }

    // ============================================================ helpers
    private void run(Runnable r) {
        if (handler == null) { r.run(); return; }
        handler.post(r);
    }

    private void respond(PluginCall call, PosApi.Result r) {
        if (r.code != null) {
            call.reject(r.code, r.message);
            return;
        }
        JSObject out = new JSObject().put("ok", true).put("rc", r.rc);
        if (r.data   != null) out.put("data",   r.data);
        if (r.bytes  != null) out.put("bytes",  Base64.encodeToString(r.bytes, Base64.NO_WRAP));
        if (r.track1 != null) out.put("track1", r.track1);
        if (r.track2 != null) out.put("track2", r.track2);
        if (r.track3 != null) out.put("track3", r.track3);
        call.resolve(out);
    }

    private static byte[] decodeBytes(String s) {
        if (s == null || s.isEmpty()) return null;
        // Try base64 first, then hex.
        try { return Base64.decode(s, Base64.DEFAULT); } catch (Throwable ignored) {}
        try {
            String clean = s.replaceAll("[^0-9a-fA-F]", "");
            if ((clean.length() & 1) == 1) return null;
            byte[] out = new byte[clean.length() / 2];
            for (int i = 0; i < out.length; i++) {
                out[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
            }
            return out;
        } catch (Throwable ignored) { return null; }
    }
}
