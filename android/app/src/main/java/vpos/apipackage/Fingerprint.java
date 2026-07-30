package vpos.apipackage;

/* JADX INFO: loaded from: classes.dex */
public class Fingerprint {
    public static native int Lib_FpClose();

    public static native int Lib_FpCode(byte[] bArr, int[] iArr);

    public static native int Lib_FpDeleteAll();

    public static native int Lib_FpMatch();

    public static native int Lib_FpOpen();

    public static native int Lib_FpRegister();

    static {
        System.loadLibrary("PosApi");
    }
}
