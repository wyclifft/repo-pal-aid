package vpos.apipackage;

/* JADX INFO: loaded from: classes.dex */
public class IDCard {
    public static native int Lib_IDCardClose();

    public static native int Lib_IDCardOpen();

    public static native int Lib_IDCardRead(String[] strArr, byte[] bArr);

    public static native int Lib_IDCardRead2(String[] strArr);

    static {
        try {
            System.loadLibrary("PosApi");
        } catch (Throwable t) {
            android.util.Log.e("VPOS", "IDCard: Failed to load PosApi native library", t);
        }
    }
}
