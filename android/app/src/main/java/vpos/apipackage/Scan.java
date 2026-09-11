package vpos.apipackage;

/* JADX INFO: loaded from: classes.dex */
public class Scan {
    public static native int Lib_ScanClose();

    public static native int Lib_ScanOpen();

    public static native int Lib_ScanRead(short s, String[] strArr);

    static {
        try {
            System.loadLibrary("PosApi");
        } catch (Throwable t) {
            android.util.Log.e("VPOS", "Scan: Failed to load PosApi native library", t);
        }
    }
}
