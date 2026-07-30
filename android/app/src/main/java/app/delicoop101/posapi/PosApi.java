package app.delicoop101.posapi;

import android.content.Context;
import android.util.Log;

import java.nio.charset.Charset;
import java.util.concurrent.atomic.AtomicBoolean;

import vpos.apipackage.Fingerprint;
import vpos.apipackage.IDCard;
import vpos.apipackage.Icc;
import vpos.apipackage.Mcr;
import vpos.apipackage.Picc;
import vpos.apipackage.PosApiHelper;
import vpos.apipackage.PrintInitException;
import vpos.apipackage.Scan;
import vpos.apipackage.Sys;

import com.cspos.PaySys;

/**
 * v2.11.28: PosApi — direct (non-reflective) wrapper around the recovered vendor
 * POS SDK (vpos.apipackage.* + com.cspos.PaySys) compiled into the app.
 *
 * The SDK sources and the matching armeabi-v7a native libraries ship with the
 * APK, so there is no "SDK missing" branch any more. Every call still catches
 * Throwable (UnsatisfiedLinkError / vendor runtime faults) and returns a
 * normalised {@link Result} so the Capacitor layer can reject with structure
 * instead of crashing the WebView.
 */
public final class PosApi {

    private static final String TAG = "PosApi";
    private static final Object LOCK = new Object();
    private static volatile PosApi instance;

    private static final Charset ASCII = Charset.forName("US-ASCII");

    public static PosApi get() {
        if (instance == null) {
            synchronized (LOCK) {
                if (instance == null) instance = new PosApi();
            }
        }
        return instance;
    }

    private final PosApiHelper helper;
    private final AtomicBoolean appInitDone = new AtomicBoolean(false);
    private volatile Throwable initError;
    private volatile int lastPrintRc = 0;

    private PosApi() {
        this.helper = PosApiHelper.getInstance();
    }

    // ------------------------------------------------------------------ init

    /** Called once from the plugin's load(). Sys.Lib_AppInit(Context) runs exactly once. */
    public Result appInit(Context ctx) {
        if (!appInitDone.compareAndSet(false, true)) {
            return Result.ok(0);
        }
        try {
            Sys.Lib_AppInit(ctx);
            Log.i(TAG, "Sys.Lib_AppInit completed");
            initError = null;
            return Result.ok(0);
        } catch (Throwable t) {
            appInitDone.set(false);
            initError = t;
            Log.e(TAG, "Sys.Lib_AppInit failed: " + t, t);
            return Result.err("HARDWARE_UNAVAILABLE", "Lib_AppInit", t);
        }
    }

    /** Ready = Lib_AppInit succeeded and a live version probe reaches the native layer. */
    public boolean isReady() {
        if (!appInitDone.get()) return false;
        try {
            Sys.Lib_GetVersion(new byte[64]);
            return true;
        } catch (Throwable t) {
            initError = t;
            return false;
        }
    }

    /**
     * v2.11.29: init lifecycle state for diagnostics — "ok" | "pending" | "failed".
     * "pending" means Lib_AppInit has not completed yet (the plugin runs it
     * asynchronously on the worker thread at load()), which used to surface to JS
     * as a bare ready=false with no error at all.
     */
    public String initState() {
        if (appInitDone.get()) return "ok";
        return initError != null ? "failed" : "pending";
    }

    public boolean isAppInitDone() { return appInitDone.get(); }

    public Throwable getInitError() { return initError; }

    /** Human readable init error, or null. */
    public String initErrorText() {
        Throwable t = initError;
        if (t == null) return null;
        String msg = t.getMessage();
        return t.getClass().getSimpleName() + (msg == null ? "" : ": " + msg);
    }


    // -------------------------------------------------------------- system
    public Result beep()     { return call("Lib_Beep",     new IntCall() { public int run() { return Sys.Lib_Beep(); } }); }
    public Result powerOn()  { return call("Lib_PowerOn",  new IntCall() { public int run() { return Sys.Lib_PowerOn(); } }); }
    public Result powerOff() { return call("Lib_PowerOff", new IntCall() { public int run() { return Sys.Lib_PowerOff(); } }); }

    public Result logSwitch(final int on) {
        return call("Lib_LogSwitch", new IntCall() { public int run() { return Sys.Lib_LogSwitch(on); } });
    }

    public Result setLed(final int idx, final int state) {
        return call("Lib_SetLed", new IntCall() {
            public int run() { return Sys.Lib_SetLed((byte) idx, (byte) state); }
        });
    }

    public Result setEntryModeOpen() {
        return call("Lib_SetEntryModeOpen", new IntCall() { public int run() { return Sys.Lib_SetEntryModeOpen(); } });
    }

    public Result setEntryModeClose() {
        return call("Lib_SetEntryModeClose", new IntCall() { public int run() { return Sys.Lib_SetEntryModeClose(); } });
    }

    public Result getVersion() {
        try {
            byte[] buf = new byte[64];
            int rc = Sys.Lib_GetVersion(buf);
            if (rc != 0) return Result.errRc("Lib_GetVersion", rc);
            return Result.okData(rc, trimAscii(buf));
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_GetVersion", t); }
    }

    public Result getSerial() {
        try {
            byte[] buf = new byte[64];
            int rc = Sys.Lib_ReadSN(buf);
            if (rc != 0) return Result.errRc("Lib_ReadSN", rc);
            return Result.okData(rc, trimAscii(buf));
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_ReadSN", t); }
    }

    public Result getChipId() {
        try {
            byte[] buf = new byte[64];
            int rc = Sys.Lib_ReadChipID(buf, buf.length);
            if (rc != 0) return Result.errRc("Lib_ReadChipID", rc);
            return Result.okData(rc, trimAscii(buf));
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_ReadChipID", t); }
    }

    public Result getTime() {
        try {
            byte[] buf = new byte[32];
            int rc = Sys.Lib_GetTime(buf);
            if (rc != 0) return Result.errRc("Lib_GetTime", rc);
            return Result.okData(rc, trimAscii(buf));
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_GetTime", t); }
    }

    public Result setTime(final String yyyymmddhhmmss) {
        return call("Lib_SetTime", new IntCall() {
            public int run() { return Sys.Lib_SetTime(yyyymmddhhmmss.getBytes(ASCII)); }
        });
    }

    // -------------------------------------------------------------- printer
    public Result printOpen() {
        try {
            int rc = helper.PrintOpen();
            lastPrintRc = rc;
            if (rc != 0) return mapPrinterRc(rc, "PrintOpen");
            return Result.ok(rc);
        } catch (PrintInitException e) {
            return Result.err("POS_ERR", "PrintOpen", e);
        } catch (Throwable t) {
            return Result.err("POS_ERR", "PrintOpen", t);
        }
    }

    /** PrintInit(gray, fontHeight, fontWidth, fontZoom) — the non-throwing overload. */
    public Result printInit(final int gray, final int fontHeight, final int fontWidth, final int fontZoom) {
        return call("PrintInit", new IntCall() {
            public int run() { return helper.PrintInit(gray, fontHeight, fontWidth, fontZoom); }
        });
    }

    public Result printStr(final String text) {
        return call("PrintStr", new IntCall() { public int run() { return helper.PrintStr(text); } });
    }

    public Result printStart() {
        try {
            int rc = helper.PrintStart();
            lastPrintRc = rc;
            return mapPrinterRc(rc, "PrintStart");
        } catch (Throwable t) {
            return Result.err("POS_ERR", "PrintStart", t);
        }
    }

    /** Live status from the printer head; falls back to the last print rc if the probe throws. */
    public Result printerStatus() {
        try {
            int rc = helper.PrintCheckStatus();
            return mapPrinterRc(rc, "PrintCheckStatus");
        } catch (Throwable t) {
            return mapPrinterRc(lastPrintRc, "PrintCheckStatus");
        }
    }

    public Result printClose() {
        return call("PrintClose", new IntCall() { public int run() { return helper.PrintClose(); } });
    }

    /** printReceipt(lines) — canonical Open → Init(2,24,24,0) → PrintStr* → Start. */
    public Result printReceipt(String[] lines) {
        Result r = printOpen();
        if (r.code != null) return r;
        r = printInit(2, 24, 24, 0);
        if (r.code != null) return r;
        if (lines != null) {
            for (String line : lines) {
                r = printStr((line == null ? "" : line) + "\n");
                if (r.code != null) return r;
            }
        }
        // trailing feed for a clean tear
        printStr("\n\n\n");
        return printStart();
    }

    // -------------------------------------------------------------- ICC
    public Result iccOpen() {
        try {
            byte[] atr = new byte[64];
            int rc = Icc.Lib_IccOpen((byte) 0, (byte) 1, atr);
            if (rc != 0) return Result.errRc("Lib_IccOpen", rc);
            return Result.okBytes(rc, atr);
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_IccOpen", t); }
    }

    public Result iccClose() {
        return call("Lib_IccClose", new IntCall() { public int run() { return Icc.Lib_IccClose((byte) 0); } });
    }

    public Result iccCheck() {
        return call("Lib_IccCheck", new IntCall() { public int run() { return Icc.Lib_IccCheck((byte) 0); } });
    }

    public Result iccCommand(byte[] apdu) {
        try {
            byte[] rsp = new byte[512];
            int rc = Icc.Lib_IccCommand((byte) 0, apdu, rsp);
            if (rc != 0) return Result.errRc("Lib_IccCommand", rc);
            return Result.okBytes(rc, rsp);
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_IccCommand", t); }
    }

    // -------------------------------------------------------------- NFC / PICC
    public Result piccOpen()   { return call("Lib_PiccOpen",   new IntCall() { public int run() { return Picc.Lib_PiccOpen(); } }); }
    public Result piccClose()  { return call("Lib_PiccClose",  new IntCall() { public int run() { return Picc.Lib_PiccClose(); } }); }
    public Result piccRemove() { return call("Lib_PiccRemove", new IntCall() { public int run() { return Picc.Lib_PiccRemove(); } }); }
    public Result piccReset()  { return call("Lib_PiccReset",  new IntCall() { public int run() { return Picc.Lib_PiccReset(); } }); }
    public Result entryPoint() { return call("Lib_EntryPoint", new IntCall() { public int run() { return Picc.Lib_EntryPoint(); } }); }

    public Result piccCheck() {
        try {
            byte[] cardType = new byte[3];
            byte[] serial   = new byte[16];
            int rc = Picc.Lib_PiccCheck((byte) 'A', cardType, serial);
            if (rc != 0) return Result.errRc("Lib_PiccCheck", rc);
            return Result.okBytes(rc, serial);
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_PiccCheck", t); }
    }

    public Result piccCommand(byte[] apdu) {
        try {
            byte[] rsp = new byte[512];
            int rc = Picc.Lib_PiccCommand(apdu, rsp);
            if (rc != 0) return Result.errRc("Lib_PiccCommand", rc);
            return Result.okBytes(rc, rsp);
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_PiccCommand", t); }
    }

    // -------------------------------------------------------------- MSR / MCR
    public Result mcrOpen()  { return call("Lib_McrOpen",  new IntCall() { public int run() { return Mcr.Lib_McrOpen(); } }); }
    public Result mcrClose() { return call("Lib_McrClose", new IntCall() { public int run() { return Mcr.Lib_McrClose(); } }); }
    public Result mcrReset() { return call("Lib_McrReset", new IntCall() { public int run() { return Mcr.Lib_McrReset(); } }); }
    public Result mcrCheck() { return call("Lib_McrCheck", new IntCall() { public int run() { return Mcr.Lib_McrCheck(); } }); }

    public Result mcrRead() {
        try {
            byte[] t1 = new byte[256];
            byte[] t2 = new byte[256];
            byte[] t3 = new byte[256];
            int rc = Mcr.Lib_McrRead((byte) 0, (byte) 0, t1, t2, t3);
            if (rc != 0) return Result.errRc("Lib_McrRead", rc);
            return Result.okTracks(rc, trimAscii(t1), trimAscii(t2), trimAscii(t3));
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_McrRead", t); }
    }

    // -------------------------------------------------------------- Scanner
    public Result scanOpen()  { return call("Lib_ScanOpen",  new IntCall() { public int run() { return Scan.Lib_ScanOpen(); } }); }
    public Result scanClose() { return call("Lib_ScanClose", new IntCall() { public int run() { return Scan.Lib_ScanClose(); } }); }

    /** SDK takes a short timeout (seconds) and writes the barcode into out[0]. */
    public Result scanRead(int timeoutMs) {
        try {
            String[] out = new String[1];
            short seconds = (short) Math.max(1, Math.min(Short.MAX_VALUE, timeoutMs / 1000));
            int rc = Scan.Lib_ScanRead(seconds, out);
            if (rc != 0) return Result.errRc("Lib_ScanRead", rc);
            return Result.okData(rc, out[0] == null ? "" : out[0]);
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_ScanRead", t); }
    }

    // -------------------------------------------------------------- Fingerprint
    public Result fpOpen()      { return call("Lib_FpOpen",      new IntCall() { public int run() { return Fingerprint.Lib_FpOpen(); } }); }
    public Result fpClose()     { return call("Lib_FpClose",     new IntCall() { public int run() { return Fingerprint.Lib_FpClose(); } }); }
    public Result fpDeleteAll() { return call("Lib_FpDeleteAll", new IntCall() { public int run() { return Fingerprint.Lib_FpDeleteAll(); } }); }
    public Result fpMatch()     { return call("Lib_FpMatch",     new IntCall() { public int run() { return Fingerprint.Lib_FpMatch(); } }); }

    /** The recovered SDK registers into the next free slot; the id argument is accepted for API stability. */
    public Result fpRegister(int id) {
        return call("Lib_FpRegister", new IntCall() { public int run() { return Fingerprint.Lib_FpRegister(); } });
    }

    public Result fpCode() {
        try {
            byte[] out = new byte[2048];
            int[] len = new int[1];
            int rc = Fingerprint.Lib_FpCode(out, len);
            if (rc != 0) return Result.errRc("Lib_FpCode", rc);
            int n = Math.max(0, Math.min(len[0], out.length));
            byte[] trimmed = new byte[n];
            System.arraycopy(out, 0, trimmed, 0, n);
            return Result.okBytes(rc, trimmed);
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_FpCode", t); }
    }

    // -------------------------------------------------------------- ID Card
    public Result idOpen()  { return call("Lib_IDCardOpen",  new IntCall() { public int run() { return IDCard.Lib_IDCardOpen(); } }); }
    public Result idClose() { return call("Lib_IDCardClose", new IntCall() { public int run() { return IDCard.Lib_IDCardClose(); } }); }

    public Result idRead() {
        try {
            String[] info = new String[10];
            byte[] photo = new byte[38 * 1024];
            int rc = IDCard.Lib_IDCardRead(info, photo);
            if (rc != 0) return Result.errRc("Lib_IDCardRead", rc);
            return Result.okData(rc, joinNonNull(info));
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_IDCardRead", t); }
    }

    public Result idRead2() {
        try {
            String[] info = new String[10];
            int rc = IDCard.Lib_IDCardRead2(info);
            if (rc != 0) return Result.errRc("Lib_IDCardRead2", rc);
            return Result.okData(rc, joinNonNull(info));
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_IDCardRead2", t); }
    }

    // -------------------------------------------------------------- Serial
    /** The SDK exposes a single serial channel; port is accepted for API stability. */
    public Result serialSend(int port, final byte[] data) {
        return call("Lib_SendBytes", new IntCall() { public int run() { return Sys.Lib_SendBytes(data, data.length); } });
    }

    public Result serialRecv(int port, int max, int timeoutMs) {
        try {
            byte[] buf = new byte[Math.max(1, max)];
            int rc = Sys.Lib_RecvBytes(buf, buf.length, timeoutMs);
            if (rc < 0) return Result.errRc("Lib_RecvBytes", rc);
            byte[] out = new byte[Math.min(rc, buf.length)];
            System.arraycopy(buf, 0, out, 0, out.length);
            return Result.okBytes(rc, out);
        } catch (Throwable t) { return Result.err("POS_ERR", "Lib_RecvBytes", t); }
    }

    // -------------------------------------------------------------- PIN Pad (PaySys)
    public Result setPadTimeout(final int seconds) {
        return call("SetPadTime", new IntCall() { public int run() { return PaySys.SetPadTime(seconds); } });
    }

    public Result setPinType(final int type) {
        return call("SetPinType", new IntCall() { public int run() { return PaySys.SetPinType(type); } });
    }

    public Result callKeyPad() {
        try {
            byte[] pin = new byte[16];
            int rc = PaySys.CallKeyPad(pin, pin.length);
            if (rc != 0) return Result.errRc("CallKeyPad", rc);
            return Result.okBytes(rc, pin);
        } catch (Throwable t) { return Result.err("POS_ERR", "CallKeyPad", t); }
    }

    public Result getPinBlock(String pan) {
        return pinBlock(pan, false);
    }

    public Result getKlkPinBlock(String pan) {
        return pinBlock(pan, true);
    }

    private Result pinBlock(String pan, boolean klk) {
        String op = klk ? "GetKLKpinblock" : "Getpinblock";
        try {
            byte[] panBytes  = pan.getBytes(ASCII);
            byte[] pinBlock  = new byte[16];
            byte[] pinLength = new byte[4];
            int rc = klk
                    ? PaySys.GetKLKpinblock(0, 0, panBytes, pinBlock, pinLength)
                    : PaySys.Getpinblock(0, 0, panBytes, pinBlock, pinLength);
            if (rc != 0) return Result.errRc(op, rc);
            return Result.okBytes(rc, pinBlock);
        } catch (Throwable t) { return Result.err("POS_ERR", op, t); }
    }

    // -------------------------------------------------------------- EMV (PaySys)
    public Result emvInit() {
        return call("EmvContextInit", new IntCall() { public int run() { return PaySys.EmvContextInit(0, 0); } });
    }

    public Result emvProcess() {
        return call("EmvProcess", new IntCall() { public int run() { return PaySys.EmvProcess(0, 0); } });
    }

    /** The recovered EmvFinal() takes no argument; the online flag is accepted for API stability. */
    public Result emvFinal(int online) {
        return call("EmvFinal", new IntCall() { public int run() { return PaySys.EmvFinal(); } });
    }

    public Result emvGetVersion() {
        try {
            byte[] buf = new byte[64];
            int rc = PaySys.EmvGetVersion(buf);
            if (rc != 0) return Result.errRc("EmvGetVersion", rc);
            return Result.okData(rc, trimAscii(buf));
        } catch (Throwable t) { return Result.err("POS_ERR", "EmvGetVersion", t); }
    }

    public Result emvSetAmount(final long amount) {
        return call("EmvSetTransAmount", new IntCall() { public int run() { return PaySys.EmvSetTransAmount((int) amount); } });
    }

    public Result emvSetTransType(final int type) {
        return call("EmvSetTransType", new IntCall() { public int run() { return PaySys.EmvSetTransType(type); } });
    }

    public Result emvSetCardType(final int type) {
        return call("EmvSetCardType", new IntCall() { public int run() { return PaySys.EmvSetCardType(type); } });
    }

    /** Online result is sent as a 2-byte ASCII response code (e.g. 0 -> "00"). */
    public Result emvSetOnlineResult(final int result) {
        return call("EmvSetOnlineResult", new IntCall() {
            public int run() {
                byte[] respCode = String.format("%02d", Math.abs(result) % 100).getBytes(ASCII);
                byte[] field55  = new byte[0];
                return PaySys.EmvSetOnlineResult(respCode, field55, field55.length);
            }
        });
    }

    public Result emvPrepare55Field() {
        try {
            byte[] buf = new byte[512];
            int rc = PaySys.EmvPrePare55Field(buf, buf.length);
            if (rc < 0) return Result.errRc("EmvPrePare55Field", rc);
            return Result.okBytes(rc, buf);
        } catch (Throwable t) { return Result.err("POS_ERR", "EmvPrePare55Field", t); }
    }

    public Result emvSaveTermParas(final byte[] paras) {
        return call("EmvSaveTermParas", new IntCall() {
            public int run() { return PaySys.EmvSaveTermParas(paras, paras.length, 0); }
        });
    }

    public Result emvClearAllAids() {
        return call("EmvClearAllAIDS", new IntCall() { public int run() { return PaySys.EmvClearAllAIDS(); } });
    }

    public Result emvClearAllCapks() {
        return call("EmvClearAllCapks", new IntCall() { public int run() { return PaySys.EmvClearAllCapks(); } });
    }

    public Result emvAddAid(final byte[] aid) {
        return call("EmvAddOneAIDS", new IntCall() { public int run() { return PaySys.EmvAddOneAIDS(aid, aid.length); } });
    }

    public Result emvAddCapk(final byte[] capk) {
        return call("EmvAddOneCAPK", new IntCall() { public int run() { return PaySys.EmvAddOneCAPK(capk, capk.length); } });
    }

    public Result emvGetTag(int tag) {
        try {
            byte[] buf = new byte[512];
            int rc = PaySys.EmvGetTagData(buf, tag, buf.length);
            if (rc < 0) return Result.errRc("EmvGetTagData", rc);
            int n = Math.max(0, Math.min(rc, buf.length));
            byte[] out = new byte[n == 0 ? buf.length : n];
            System.arraycopy(buf, 0, out, 0, out.length);
            return Result.okBytes(rc, out);
        } catch (Throwable t) { return Result.err("POS_ERR", "EmvGetTagData", t); }
    }

    // ============================================================ helpers
    private interface IntCall { int run(); }

    /** Runs a native call, normalising both non-zero return codes and thrown errors. */
    private Result call(String op, IntCall c) {
        try {
            int rc = c.run();
            if (rc != 0) return Result.errRc(op, rc);
            return Result.ok(rc);
        } catch (Throwable t) {
            return Result.err("POS_ERR", op, t);
        }
    }

    private static String trimAscii(byte[] buf) {
        int n = 0;
        while (n < buf.length && buf[n] != 0) n++;
        return new String(buf, 0, n, ASCII).trim();
    }

    private static String joinNonNull(String[] parts) {
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (p == null || p.length() == 0) continue;
            if (sb.length() > 0) sb.append('|');
            sb.append(p);
        }
        return sb.toString();
    }

    // --------------- Printer rc → normalised error code
    private static Result mapPrinterRc(int rc, String op) {
        switch (rc) {
            case 0:  return Result.ok(0);
            case -1: return Result.err("NO_PAPER",           op, -1);
            case -2: return Result.err("PRINTER_OVERHEATED", op, -2);
            case -3: return Result.err("LOW_BATTERY",        op, -3);
            default: return Result.errRc(op, rc);
        }
    }

    // ============================================================ Result
    public static final class Result {
        public final int rc;
        public final String code;      // null if ok
        public final String message;   // null if ok
        public final String data;      // ascii payload if any
        public final byte[] bytes;     // raw payload if any
        public final String track1, track2, track3;

        private Result(int rc, String code, String message, String data, byte[] bytes,
                       String t1, String t2, String t3) {
            this.rc = rc;
            this.code = code;
            this.message = message;
            this.data = data;
            this.bytes = bytes;
            this.track1 = t1; this.track2 = t2; this.track3 = t3;
        }
        public static Result ok(int rc)                        { return new Result(rc, null, null, null, null, null, null, null); }
        public static Result okData(int rc, String data)       { return new Result(rc, null, null, data, null, null, null, null); }
        public static Result okBytes(int rc, byte[] b)         { return new Result(rc, null, null, null, b, null, null, null); }
        public static Result okTracks(int rc, String a, String b, String c) {
            return new Result(rc, null, null, null, null, a, b, c);
        }
        public static Result err(String code, String op, Throwable t) {
            String msg = op + ": " + (t == null ? code : (t.getClass().getSimpleName() + " " + (t.getMessage() == null ? "" : t.getMessage())));
            return new Result(0, code, msg, null, null, null, null, null);
        }
        public static Result err(String code, String op, int rc) {
            return new Result(rc, code, op + " rc=" + rc, null, null, null, null, null);
        }
        public static Result errRc(String op, int rc) {
            return new Result(rc, "POS_ERR_" + rc, op + " returned " + rc, null, null, null, null, null);
        }
    }
}
