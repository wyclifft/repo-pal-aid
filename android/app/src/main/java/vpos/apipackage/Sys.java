package vpos.apipackage;

import android.content.Context;

/* JADX INFO: loaded from: classes.dex */
public class Sys {
    public static native void Lib_AppInit(Context context);

    public static native int Lib_Beep();

    public static native int Lib_Des(byte[] bArr, byte[] bArr2, byte[] bArr3, int i);

    public static native int Lib_GetTime(byte[] bArr);

    public static native int Lib_GetVersion(byte[] bArr);

    public static native int Lib_KeyEvent();

    public static native int Lib_LedCtrl(byte b, byte b2);

    public static native int Lib_LogSwitch(int i);

    public static native int Lib_PowerOff();

    public static native int Lib_PowerOn();

    public static native int Lib_ReadChipID(byte[] bArr, int i);

    public static native int Lib_ReadSN(byte[] bArr);

    public static native int Lib_RecvBytes(byte[] bArr, int i, int i2);

    public static native int Lib_RecvPacket(byte[] bArr, int[] iArr, int i);

    public static native int Lib_RsaDecrypt(byte[] bArr, int i, byte[] bArr2, byte[] bArr3, int i2, byte[] bArr4);

    public static native int Lib_RsaEncrypt(byte[] bArr, int i, byte[] bArr2, int i2, byte[] bArr3);

    public static native int Lib_SecuTamperBit(byte b, byte b2);

    public static native int Lib_SendBytes(byte[] bArr, int i);

    public static native int Lib_SendPacket(byte[] bArr, int i, byte b, byte b2);

    public static native int Lib_SetEntryMode(byte b);

    public static native int Lib_SetEntryModeClose();

    public static native int Lib_SetEntryModeOpen();

    public static native int Lib_SetLed(byte b, byte b2);

    public static native int Lib_SetTime(byte[] bArr);

    public static native int Lib_Test(byte b);

    public static native int Lib_Update();

    public static native int Lib_WriteSN(byte[] bArr);

    public static native int Print_Black();

    public static native int Print_Time();

    public static native int Test_uarts();

    static {
        System.loadLibrary("PosApi");
    }
}
