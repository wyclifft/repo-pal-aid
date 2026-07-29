package app.delicoop101.posapi;

import android.content.Context;
import android.util.Log;

import java.lang.reflect.Method;
import java.nio.charset.Charset;

/**
 * v2.11.27: PosApi — thin, reflection-based wrapper around the vendor POS SDK
 * (vpos.apipackage.PosApiHelper + com.cspos.PaySys). Reflection keeps the build
 * green whether or not the vendor JAR is present at compile time, and matches
 * the defensive pattern used across v2.11.22+.
 *
 * Only methods explicitly confirmed in the decompiled SDK are exposed. Every
 * call catches Throwable and returns a normalised {@link Result} so the
 * Capacitor layer can produce structured PluginCall.reject() responses.
 */
public final class PosApi {

    private static final String TAG = "PosApi";
    private static final Object LOCK = new Object();
    private static volatile PosApi instance;

    // ------------------------------------------------------------------ init
    public static PosApi get() {
        if (instance == null) {
            synchronized (LOCK) {
                if (instance == null) instance = new PosApi();
            }
        }
        return instance;
    }

    private final Object helper;                  // PosApiHelper.getInstance() or null
    private final Class<?> helperClass;           // vpos.apipackage.PosApiHelper
    private final Class<?> paySysClass;           // com.cspos.PaySys
    private final Throwable initError;
    private volatile int lastPrintRc = 0;

    private PosApi() {
        Object h = null;
        Class<?> hc = null;
        Class<?> ps = null;
        Throwable err = null;
        try {
            hc = Class.forName("vpos.apipackage.PosApiHelper");
            Method getInstance = hc.getMethod("getInstance");
            h = getInstance.invoke(null);
        } catch (Throwable t) {
            err = t;
            Log.w(TAG, "PosApiHelper unavailable: " + t.getClass().getName() + " " + t.getMessage());
        }
        try {
            ps = Class.forName("com.cspos.PaySys");
        } catch (Throwable t) {
            Log.w(TAG, "com.cspos.PaySys unavailable: " + t.getMessage());
        }
        this.helper = h;
        this.helperClass = hc;
        this.paySysClass = ps;
        this.initError = err;
    }

    /** Called from the plugin's load(). Runs Sys.Lib_AppInit(Context) once, best-effort. */
    public Result appInit(Context ctx) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            Class<?> sys;
            try {
                sys = Class.forName("vpos.apipackage.Sys");
            } catch (ClassNotFoundException e) {
                // Some builds attach Lib_AppInit directly on PosApiHelper.
                return invokeInt(helper, "Lib_AppInit", new Class[]{Context.class}, new Object[]{ctx});
            }
            Method m = sys.getMethod("Lib_AppInit", Context.class);
            Object r = m.invoke(null, ctx);
            return Result.ok(rcInt(r));
        } catch (Throwable t) {
            return Result.err("HARDWARE_UNAVAILABLE", "Lib_AppInit", t);
        }
    }

    public boolean isReady() { return helper != null; }
    public Throwable getInitError() { return initError; }

    // -------------------------------------------------------------- system
    public Result beep()      { return invokeInt(helper, "Lib_Beep",     null, null); }
    public Result powerOn()   { return invokeInt(helper, "Lib_PowerOn",  null, null); }
    public Result powerOff()  { return invokeInt(helper, "Lib_PowerOff", null, null); }
    public Result logSwitch(int on) {
        return invokeInt(helper, "Lib_LogSwitch", new Class[]{int.class}, new Object[]{on});
    }
    public Result setLed(int idx, int state) {
        return invokeInt(helper, "Lib_SetLed", new Class[]{int.class, int.class}, new Object[]{idx, state});
    }
    public Result setEntryModeOpen()  { return invokeInt(helper, "Lib_SetEntryModeOpen", null, null); }
    public Result setEntryModeClose() { return invokeInt(helper, "Lib_SetEntryModeClose", null, null); }

    public Result readBuffer(String method, int size) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] buf = new byte[size];
            Method m = findMethod(helperClass, method, byte[].class);
            if (m == null) return Result.err("POS_ERR", method, new NoSuchMethodException(method));
            Object r = m.invoke(helper, (Object) buf);
            int rc = rcInt(r);
            if (rc != 0) return Result.errRc(method, rc);
            return Result.okData(rc, trimAscii(buf));
        } catch (Throwable t) {
            return Result.err("POS_ERR", method, t);
        }
    }

    public Result getVersion() { return readBuffer("Lib_GetVersion", 64); }
    public Result getSerial()  { return readBuffer("Lib_ReadSN",     64); }
    public Result getChipId()  { return readBuffer("Lib_ReadChipID", 64); }
    public Result getTime()    { return readBuffer("Lib_GetTime",    32); }

    public Result setTime(String yyyymmddhhmmss) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] buf = yyyymmddhhmmss.getBytes(Charset.forName("US-ASCII"));
            Method m = findMethod(helperClass, "Lib_SetTime", byte[].class);
            if (m == null) return Result.err("POS_ERR", "Lib_SetTime", new NoSuchMethodException());
            return Result.ok(rcInt(m.invoke(helper, (Object) buf)));
        } catch (Throwable t) {
            return Result.err("POS_ERR", "Lib_SetTime", t);
        }
    }

    // -------------------------------------------------------------- printer
    public Result printOpen() {
        Result r = invokeInt(helper, "PrintOpen", null, null);
        if (r.code == null) lastPrintRc = r.rc;
        return r;
    }
    public Result printInit(int densityLevel, int leftMargin, int lineSpace, int reserved) {
        return invokeInt(helper, "PrintInit",
                new Class[]{int.class, int.class, int.class, int.class},
                new Object[]{densityLevel, leftMargin, lineSpace, reserved});
    }
    public Result printStr(String text) {
        return invokeInt(helper, "PrintStr", new Class[]{String.class}, new Object[]{text});
    }
    public Result printStart() {
        Result r = invokeInt(helper, "PrintStart", null, null);
        lastPrintRc = r.rc;
        return mapPrinterRc(r);
    }
    public Result printerStatus() {
        return mapPrinterRc(Result.ok(lastPrintRc));
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
        // trailing feed for clean cut / tear
        printStr("\n\n\n");
        return printStart();
    }

    // -------------------------------------------------------------- ICC
    public Result iccOpen()  { return invokeInt(helper, "IccOpen",  null, null); }
    public Result iccClose() { return invokeInt(helper, "IccClose", null, null); }
    public Result iccCheck() {
        // Common signature: IccCheck(byte slot)
        return invokeInt(helper, "IccCheck", new Class[]{byte.class}, new Object[]{(byte) 0});
    }
    public Result iccCommand(byte[] apdu) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] rsp = new byte[512];
            byte[] rspLen = new byte[4];
            Method m = findMethod(helperClass, "IccCommand", byte.class, byte[].class, byte[].class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "IccCommand", new NoSuchMethodException());
            Object r = m.invoke(helper, (byte) 0, apdu, rsp, rspLen);
            int rc = rcInt(r);
            if (rc != 0) return Result.errRc("IccCommand", rc);
            int n = ((rspLen[0] & 0xff) << 8) | (rspLen[1] & 0xff);
            byte[] out = new byte[Math.min(n, rsp.length)];
            System.arraycopy(rsp, 0, out, 0, out.length);
            return Result.okBytes(rc, out);
        } catch (Throwable t) {
            return Result.err("POS_ERR", "IccCommand", t);
        }
    }

    // -------------------------------------------------------------- NFC / PICC
    public Result piccOpen()   { return invokeInt(helper, "PiccOpen",  null, null); }
    public Result piccClose()  { return invokeInt(helper, "PiccClose", null, null); }
    public Result piccRemove() { return invokeInt(helper, "PiccRemove", null, null); }
    public Result piccReset()  { return invokeInt(helper, "PiccReset", null, null); }
    public Result piccCheck() {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] cardType = new byte[2];
            byte[] serial   = new byte[16];
            Method m = findMethod(helperClass, "PiccCheck", byte.class, byte[].class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "PiccCheck", new NoSuchMethodException());
            Object r = m.invoke(helper, (byte) 'A', cardType, serial);
            int rc = rcInt(r);
            if (rc != 0) return Result.errRc("PiccCheck", rc);
            return Result.okBytes(rc, serial);
        } catch (Throwable t) {
            return Result.err("POS_ERR", "PiccCheck", t);
        }
    }
    public Result piccCommand(byte[] apdu) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] rsp = new byte[512];
            byte[] rspLen = new byte[4];
            Method m = findMethod(helperClass, "PiccCommand", byte[].class, byte[].class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "PiccCommand", new NoSuchMethodException());
            Object r = m.invoke(helper, apdu, rsp, rspLen);
            int rc = rcInt(r);
            if (rc != 0) return Result.errRc("PiccCommand", rc);
            int n = ((rspLen[0] & 0xff) << 8) | (rspLen[1] & 0xff);
            byte[] out = new byte[Math.min(n, rsp.length)];
            System.arraycopy(rsp, 0, out, 0, out.length);
            return Result.okBytes(rc, out);
        } catch (Throwable t) {
            return Result.err("POS_ERR", "PiccCommand", t);
        }
    }
    public Result entryPoint() { return invokeInt(helper, "EntryPoint", null, null); }

    // -------------------------------------------------------------- MSR / MCR
    public Result mcrOpen()  { return invokeInt(helper, "McrOpen",  null, null); }
    public Result mcrClose() { return invokeInt(helper, "McrClose", null, null); }
    public Result mcrReset() { return invokeInt(helper, "McrReset", null, null); }
    public Result mcrCheck() { return invokeInt(helper, "McrCheck", null, null); }
    public Result mcrRead() {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] t1 = new byte[256];
            byte[] t2 = new byte[256];
            byte[] t3 = new byte[256];
            Method m = findMethod(helperClass, "McrRead", byte[].class, byte[].class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "McrRead", new NoSuchMethodException());
            Object r = m.invoke(helper, t1, t2, t3);
            int rc = rcInt(r);
            if (rc != 0) return Result.errRc("McrRead", rc);
            return Result.okTracks(rc, trimAscii(t1), trimAscii(t2), trimAscii(t3));
        } catch (Throwable t) {
            return Result.err("POS_ERR", "McrRead", t);
        }
    }

    // -------------------------------------------------------------- Scanner
    public Result scanOpen()  { return invokeInt(helper, "ScanOpen",  null, null); }
    public Result scanClose() { return invokeInt(helper, "ScanClose", null, null); }
    public Result scanRead(int timeoutMs) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] out = new byte[512];
            byte[] len = new byte[4];
            // Common: ScanRead(int timeout, byte[] out) or ScanRead(byte[] out, byte[] len)
            Method m = findMethod(helperClass, "ScanRead", int.class, byte[].class);
            int rc;
            if (m != null) {
                rc = rcInt(m.invoke(helper, timeoutMs, out));
            } else {
                Method m2 = findMethod(helperClass, "ScanRead", byte[].class, byte[].class);
                if (m2 == null) return Result.err("POS_ERR", "ScanRead", new NoSuchMethodException());
                rc = rcInt(m2.invoke(helper, out, len));
            }
            if (rc != 0) return Result.errRc("ScanRead", rc);
            return Result.okData(rc, trimAscii(out));
        } catch (Throwable t) {
            return Result.err("POS_ERR", "ScanRead", t);
        }
    }

    // -------------------------------------------------------------- Fingerprint
    public Result fpOpen()        { return invokeInt(helper, "FpOpen",  null, null); }
    public Result fpClose()       { return invokeInt(helper, "FpClose", null, null); }
    public Result fpDeleteAll()   { return invokeInt(helper, "FpDeleteAll", null, null); }
    public Result fpRegister(int id) {
        return invokeInt(helper, "FpRegister", new Class[]{int.class}, new Object[]{id});
    }
    public Result fpMatch() { return invokeInt(helper, "FpMatch", null, null); }
    public Result fpCode() {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] out = new byte[2048];
            Method m = findMethod(helperClass, "FpCode", byte[].class);
            if (m == null) return Result.err("POS_ERR", "FpCode", new NoSuchMethodException());
            int rc = rcInt(m.invoke(helper, (Object) out));
            if (rc != 0) return Result.errRc("FpCode", rc);
            return Result.okBytes(rc, out);
        } catch (Throwable t) {
            return Result.err("POS_ERR", "FpCode", t);
        }
    }

    // -------------------------------------------------------------- ID Card
    public Result idOpen()  { return invokeInt(helper, "IDCardOpen",  null, null); }
    public Result idClose() { return invokeInt(helper, "IDCardClose", null, null); }
    public Result idRead() {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] info = new byte[1024];
            byte[] photo = new byte[16 * 1024];
            byte[] len = new byte[8];
            Method m = findMethod(helperClass, "IDCardRead", byte[].class, byte[].class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "IDCardRead", new NoSuchMethodException());
            int rc = rcInt(m.invoke(helper, info, photo, len));
            if (rc != 0) return Result.errRc("IDCardRead", rc);
            return Result.okData(rc, trimAscii(info));
        } catch (Throwable t) {
            return Result.err("POS_ERR", "IDCardRead", t);
        }
    }
    public Result idRead2() {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] info = new byte[1024];
            byte[] photo = new byte[16 * 1024];
            byte[] fp = new byte[2048];
            byte[] len = new byte[12];
            Method m = findMethod(helperClass, "IDCardRead2", byte[].class, byte[].class, byte[].class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "IDCardRead2", new NoSuchMethodException());
            int rc = rcInt(m.invoke(helper, info, photo, fp, len));
            if (rc != 0) return Result.errRc("IDCardRead2", rc);
            return Result.okData(rc, trimAscii(info));
        } catch (Throwable t) {
            return Result.err("POS_ERR", "IDCardRead2", t);
        }
    }

    // -------------------------------------------------------------- Serial
    public Result serialSend(int port, byte[] data) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            Method m = findMethod(helperClass, "SendBytes", int.class, byte[].class, int.class);
            if (m == null) return Result.err("POS_ERR", "SendBytes", new NoSuchMethodException());
            return Result.ok(rcInt(m.invoke(helper, port, data, data.length)));
        } catch (Throwable t) { return Result.err("POS_ERR", "SendBytes", t); }
    }
    public Result serialRecv(int port, int max, int timeoutMs) {
        if (helper == null) return Result.hwUnavailable(initError);
        try {
            byte[] buf = new byte[max];
            Method m = findMethod(helperClass, "RecvBytes", int.class, byte[].class, int.class);
            if (m == null) return Result.err("POS_ERR", "RecvBytes", new NoSuchMethodException());
            int rc = rcInt(m.invoke(helper, port, buf, timeoutMs));
            if (rc < 0) return Result.errRc("RecvBytes", rc);
            byte[] out = new byte[Math.max(0, Math.min(rc, buf.length))];
            System.arraycopy(buf, 0, out, 0, out.length);
            return Result.okBytes(rc, out);
        } catch (Throwable t) { return Result.err("POS_ERR", "RecvBytes", t); }
    }

    // -------------------------------------------------------------- PIN Pad (PaySys)
    public Result setPadTimeout(int seconds) {
        return psInvokeInt("SetPadTime", new Class[]{int.class}, new Object[]{seconds});
    }
    public Result setPinType(int type) {
        return psInvokeInt("SetPinType", new Class[]{int.class}, new Object[]{type});
    }
    public Result callKeyPad() {
        return psInvokeInt("CallKeyPad", null, null);
    }
    public Result getPinBlock(String pan) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            byte[] pinBlock = new byte[16];
            Method m = findMethod(paySysClass, "Getpinblock", String.class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "Getpinblock", new NoSuchMethodException());
            int rc = rcInt(m.invoke(null, pan, pinBlock));
            if (rc != 0) return Result.errRc("Getpinblock", rc);
            return Result.okBytes(rc, pinBlock);
        } catch (Throwable t) { return Result.err("POS_ERR", "Getpinblock", t); }
    }
    public Result getKlkPinBlock(String pan) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            byte[] pinBlock = new byte[16];
            Method m = findMethod(paySysClass, "GetKLKpinblock", String.class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "GetKLKpinblock", new NoSuchMethodException());
            int rc = rcInt(m.invoke(null, pan, pinBlock));
            if (rc != 0) return Result.errRc("GetKLKpinblock", rc);
            return Result.okBytes(rc, pinBlock);
        } catch (Throwable t) { return Result.err("POS_ERR", "GetKLKpinblock", t); }
    }

    // -------------------------------------------------------------- EMV (PaySys)
    public Result emvInit()               { return psInvokeInt("EmvContextInit", null, null); }
    public Result emvProcess()            { return psInvokeInt("EmvProcess",     null, null); }
    public Result emvFinal(int online)    { return psInvokeInt("EmvFinal", new Class[]{int.class}, new Object[]{online}); }
    public Result emvGetVersion()         { return psReadBuffer("EmvGetVersion", 32); }
    public Result emvSetAmount(long amt)  { return psInvokeInt("EmvSetTransAmount", new Class[]{long.class}, new Object[]{amt}); }
    public Result emvSetTransType(int t)  { return psInvokeInt("EmvSetTransType",  new Class[]{int.class},  new Object[]{t}); }
    public Result emvSetCardType(int t)   { return psInvokeInt("EmvSetCardType",   new Class[]{int.class},  new Object[]{t}); }
    public Result emvSetOnlineResult(int r) { return psInvokeInt("EmvSetOnlineResult", new Class[]{int.class}, new Object[]{r}); }
    public Result emvPrepare55Field()     { return psReadBuffer("EmvPrePare55Field", 512); }
    public Result emvSaveTermParas(byte[] paras) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            Method m = findMethod(paySysClass, "EmvSaveTermParas", byte[].class);
            if (m == null) return Result.err("POS_ERR", "EmvSaveTermParas", new NoSuchMethodException());
            return Result.ok(rcInt(m.invoke(null, (Object) paras)));
        } catch (Throwable t) { return Result.err("POS_ERR", "EmvSaveTermParas", t); }
    }
    public Result emvClearAllAids()   { return psInvokeInt("EmvClearAllAIDS", null, null); }
    public Result emvClearAllCapks()  { return psInvokeInt("EmvClearAllCapks", null, null); }
    public Result emvAddAid(byte[] aid) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            Method m = findMethod(paySysClass, "EmvAddOneAIDS", byte[].class);
            if (m == null) return Result.err("POS_ERR", "EmvAddOneAIDS", new NoSuchMethodException());
            return Result.ok(rcInt(m.invoke(null, (Object) aid)));
        } catch (Throwable t) { return Result.err("POS_ERR", "EmvAddOneAIDS", t); }
    }
    public Result emvAddCapk(byte[] capk) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            Method m = findMethod(paySysClass, "EmvAddOneCAPK", byte[].class);
            if (m == null) return Result.err("POS_ERR", "EmvAddOneCAPK", new NoSuchMethodException());
            return Result.ok(rcInt(m.invoke(null, (Object) capk)));
        } catch (Throwable t) { return Result.err("POS_ERR", "EmvAddOneCAPK", t); }
    }
    public Result emvGetTag(int tag) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            byte[] buf = new byte[512];
            byte[] len = new byte[4];
            Method m = findMethod(paySysClass, "EmvGetTagData", int.class, byte[].class, byte[].class);
            if (m == null) return Result.err("POS_ERR", "EmvGetTagData", new NoSuchMethodException());
            int rc = rcInt(m.invoke(null, tag, buf, len));
            if (rc != 0) return Result.errRc("EmvGetTagData", rc);
            int n = ((len[0] & 0xff) << 8) | (len[1] & 0xff);
            byte[] out = new byte[Math.min(n, buf.length)];
            System.arraycopy(buf, 0, out, 0, out.length);
            return Result.okBytes(rc, out);
        } catch (Throwable t) { return Result.err("POS_ERR", "EmvGetTagData", t); }
    }

    // ============================================================ helpers
    private Result psInvokeInt(String name, Class<?>[] argTypes, Object[] args) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            Method m = argTypes == null ? paySysClass.getMethod(name) : paySysClass.getMethod(name, argTypes);
            return Result.ok(rcInt(m.invoke(null, args == null ? new Object[0] : args)));
        } catch (Throwable t) {
            return Result.err("POS_ERR", name, t);
        }
    }
    private Result psReadBuffer(String name, int size) {
        if (paySysClass == null) return Result.hwUnavailable(initError);
        try {
            byte[] buf = new byte[size];
            Method m = findMethod(paySysClass, name, byte[].class);
            if (m == null) return Result.err("POS_ERR", name, new NoSuchMethodException());
            int rc = rcInt(m.invoke(null, (Object) buf));
            if (rc != 0) return Result.errRc(name, rc);
            return Result.okData(rc, trimAscii(buf));
        } catch (Throwable t) { return Result.err("POS_ERR", name, t); }
    }

    private Result invokeInt(Object target, String name, Class<?>[] argTypes, Object[] args) {
        if (helper == null || helperClass == null) return Result.hwUnavailable(initError);
        try {
            Method m = argTypes == null ? helperClass.getMethod(name) : helperClass.getMethod(name, argTypes);
            Object r = m.invoke(target, args == null ? new Object[0] : args);
            return Result.ok(rcInt(r));
        } catch (Throwable t) {
            return Result.err("POS_ERR", name, t);
        }
    }

    private static Method findMethod(Class<?> owner, String name, Class<?>... types) {
        try { return owner.getMethod(name, types); }
        catch (NoSuchMethodException e) { /* try declared */ }
        try {
            Method m = owner.getDeclaredMethod(name, types);
            m.setAccessible(true);
            return m;
        } catch (NoSuchMethodException e) {
            // Fallback: match by name + arg count (types may vary across SDK builds).
            for (Method m : owner.getMethods()) {
                if (m.getName().equals(name) && m.getParameterTypes().length == types.length) {
                    return m;
                }
            }
            return null;
        }
    }

    private static int rcInt(Object r) {
        if (r == null) return 0;
        if (r instanceof Integer) return (Integer) r;
        if (r instanceof Long) return ((Long) r).intValue();
        if (r instanceof Short) return ((Short) r).intValue();
        if (r instanceof Byte) return ((Byte) r).intValue();
        return 0;
    }

    private static String trimAscii(byte[] buf) {
        int n = 0;
        while (n < buf.length && buf[n] != 0) n++;
        return new String(buf, 0, n, Charset.forName("US-ASCII")).trim();
    }

    // --------------- Printer rc → normalised error code
    private static Result mapPrinterRc(Result raw) {
        if (raw.code != null) return raw;
        switch (raw.rc) {
            case 0:  return Result.ok(0);
            case -1: return Result.err("NO_PAPER",           "PrintStart", -1);
            case -2: return Result.err("PRINTER_OVERHEATED", "PrintStart", -2);
            case -3: return Result.err("LOW_BATTERY",        "PrintStart", -3);
            default: return Result.errRc("PrintStart", raw.rc);
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
        public static Result hwUnavailable(Throwable t) {
            String detail = t == null ? "vendor SDK not on classpath (expected vpos.apipackage.PosApiHelper)"
                                      : (t.getClass().getSimpleName() + " " + (t.getMessage() == null ? "" : t.getMessage()));
            return new Result(0, "HARDWARE_UNAVAILABLE", detail, null, null, null, null, null);
        }
    }
}
