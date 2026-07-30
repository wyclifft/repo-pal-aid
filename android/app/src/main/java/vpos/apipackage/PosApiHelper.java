package vpos.apipackage;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.IBinder;
import android.provider.Settings;
import android.util.Log;
import com.cspos.PaySys;
import com.google.zxing.BarcodeFormat;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import vpos.util.Util;

/* JADX INFO: loaded from: classes.dex */
public class PosApiHelper {
    private static final String AAR_VERSION = "2.4.1";
    private static final int MAX_INTERVAL = 20000;
    private static final String MCU_NODE_FILE = "/sys/devices/platform/mcu_dev/mcudev_pwren";
    private static final int MIN_INTERVAL = 20000;
    private static final String NODE_BATT_STATUS = "/sys/class/power_supply/battery/status";
    private static final String NODE_BATT_VOL = "/sys/class/power_supply/battery/batt_vol";
    public static final int PRINT_MAX_LEN = 624;
    private static final String SET_LEFT_VOLUME_KEY_SCAN = "android.intent.action.SET_LEFT_VOLUME_KEY_SCAN";
    private static final String SET_RIGHT_VOLUME_KEY_SCAN = "android.intent.action.SET_RIGHT_VOLUME_KEY_SCAN";
    private static PosApiHelper mInstance;
    private int BatteryV;
    private int ret;
    private byte[] version = new byte[9];
    private static final Object mLock = new Object();
    // v2.11.29: resolved lazily. The CS10 firmware has no com.android.server.bcr
    // .IBCRService, and eager resolution in the static initialiser spammed logcat
    // with ClassNotFoundException stack traces on every app start.
    private static Object mBCRService = null;

    public static String TmpStr = "";

    public int SetMcuPowerMode(int mode) {
        try {
            FileOutputStream fps = new FileOutputStream(new File(MCU_NODE_FILE));
            fps.write((mode + "").getBytes());
            fps.close();
            if (mode != 1) {
                return 0;
            }
            long startTime = System.currentTimeMillis();
            while (true) {
                long currentTime = System.currentTimeMillis();
                if (currentTime - startTime > 20000 && currentTime - startTime < 20000) {
                    this.ret = SysGetVersion(this.version);
                    if (this.ret == 0) {
                        return 0;
                    }
                    Util.sleepMs(200);
                } else if (currentTime - startTime > 20000) {
                    return -2;
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
            return -1;
        }
    }

    public int Des(byte[] input, byte[] output, byte[] deskey, int mode) {
        return Sys.Lib_Des(input, output, deskey, mode);
    }

    public int getBatteryV() {
        return this.BatteryV;
    }

    public void setBatteryV(int batteryV) {
        this.BatteryV = batteryV;
    }

    public static PosApiHelper getInstance() {
        PosApiHelper posApiHelper;
        synchronized (mLock) {
            if (mInstance == null) {
                mInstance = new PosApiHelper();
            }
            posApiHelper = mInstance;
        }
        return posApiHelper;
    }

    public int IccCheck(byte slot) {
        return Icc.Lib_IccCheck(slot);
    }

    public int IccOpen(byte slot, byte vccMode, byte[] atr) {
        return Icc.Lib_IccOpen(slot, vccMode, atr);
    }

    public int IccCommand(byte slot, byte[] apduSend, byte[] apduResp) {
        return Icc.Lib_IccCommand(slot, apduSend, apduResp);
    }

    public int IccClose(byte slot) {
        return Icc.Lib_IccClose(slot);
    }

    public int PiccOpen() {
        return Picc.Lib_PiccOpen();
    }

    public int PiccCheck(byte mode, byte[] cardType, byte[] serialNo) {
        return Picc.Lib_PiccCheck(mode, cardType, serialNo);
    }

    public int PiccCommand(byte[] apduSend, byte[] apduResp) {
        return Picc.Lib_PiccCommand(apduSend, apduResp);
    }

    public int EntryPoint_Detect() {
        int ret = Picc.Lib_EntryPoint();
        return ret;
    }

    public int EntryPoint_Open() {
        return Sys.Lib_SetEntryModeOpen();
    }

    public int EntryPoint_Close() {
        return Sys.Lib_SetEntryModeClose();
    }

    public int SysSetEntryMode(int mode) {
        return Sys.Lib_SetEntryMode((byte) mode);
    }

    public int PiccClose() {
        return Picc.Lib_PiccClose();
    }

    public int PiccRemove() {
        return Picc.Lib_PiccRemove();
    }

    public int PiccHalt() {
        return Picc.Lib_PiccHalt();
    }

    public int PiccReset() {
        return Picc.Lib_PiccReset();
    }

    public int PiccNfc(byte[] NfcData_Len, byte[] Technology, byte[] UID, byte[] NDEF_message) {
        return Picc.Lib_PiccNfc(NfcData_Len, Technology, UID, NDEF_message);
    }

    public int PiccPoll(byte[] CardType, byte[] UID, byte[] ucUIDLen, byte[] ATS, byte[] ucATSLen, byte[] SAK) {
        return Picc.Lib_PiccPolling(CardType, UID, ucUIDLen, ATS, ucATSLen, SAK);
    }

    public int PiccM1Authority(byte type, byte blkNo, byte[] pwd, byte[] serialNo) {
        return Picc.Lib_PiccM1Authority(type, blkNo, pwd, serialNo);
    }

    public int PiccM1ReadBlock(int blkNo, byte[] blkValue) {
        return Picc.Lib_PiccM1ReadBlock((byte) blkNo, blkValue);
    }

    public int PiccM1WriteBlock(int blkNo, byte[] blkValue) {
        return Picc.Lib_PiccM1WriteBlock((byte) blkNo, blkValue);
    }

    public int PiccM1Operate(byte type, byte blkNo, byte[] value, byte updateBlkNo) {
        return Picc.Lib_PiccM1Operate(type, blkNo, value, updateBlkNo);
    }

    public int PiccM1WriteValue(int blkNo, byte[] value) {
        return Picc.Lib_PiccM1WriteValue(blkNo, value);
    }

    public int PiccM1ReadValue(int blkNo, byte[] value) {
        return Picc.Lib_PiccM1ReadValue(blkNo, value);
    }

    public int McrClose() {
        return Mcr.Lib_McrClose();
    }

    public int McrOpen() {
        return Mcr.Lib_McrOpen();
    }

    public int McrReset() {
        return Mcr.Lib_McrReset();
    }

    public int McrCheck() {
        return Mcr.Lib_McrCheck();
    }

    public int McrRead(byte keyNo, byte mode, byte[] track1, byte[] track2, byte[] track3) {
        return Mcr.Lib_McrRead(keyNo, mode, track1, track2, track3);
    }

    public int PrintInit() throws PrintInitException {
        int ret = PrintInit(3, 24, 24, 0);
        if (ret != 0) {
            throw new PrintInitException(ret);
        }
        return ret;
    }

    public int PrintInit(int gray, int fontHeight, int fontWidth, int fontZoom) {
        int ret = Print.Lib_PrnInit();
        if (ret != 0) {
            return ret;
        }
        int ret2 = Print.Lib_PrnSetGray(gray);
        if (ret2 != 0) {
            return ret2;
        }
        int ret3 = Print.Lib_PrnSetFont((byte) fontHeight, (byte) fontWidth, (byte) fontZoom);
        if (ret3 != 0) {
            return ret3;
        }
        return ret3;
    }

    public int PrintSetVoltage(int voltage) {
        return Print.Lib_PrnSetVoltage(voltage);
    }

    public int PrintCheckStatus() {
        // v2.11.28: battery nodes may be unreadable on some firmware; treat as non-charging.
        int voltage = 0;
        String status = "";
        try {
            voltage = Integer.parseInt(readSysBattFile(NODE_BATT_VOL));
            status = readSysBattFile(NODE_BATT_STATUS);
        } catch (Exception e) {
            e.printStackTrace();
        }
        if (!"Charging".equals(status)) {
            Print.Lib_PrnIsCharge(0);
        } else {
            Print.Lib_PrnIsCharge(1);
        }
        int ret = Print.Lib_PrnSetVoltage((voltage * 2) / 100);
        if (ret != 0) {
            return ret;
        }
        return Print.Lib_PrnCheckStatus();
    }

    public int PrintCtnStart() {
        int ret = PrintCheckStatus();
        if (ret != 0) {
            return ret;
        }
        return Print.Lib_CTNPrnStart();
    }

    public int PrintClose() {
        return Print.Lib_PrnClose();
    }

    public int PrnConventional(int nlevel) {
        return Print.Lib_PrnConventional(nlevel);
    }

    public int PrnContinuous(int nlevel) {
        return Print.Lib_PrnContinuous(nlevel);
    }

    public int PrintOpen() throws PrintInitException {
        int ret = PrintInit();
        if (ret != 0) {
            throw new PrintInitException(ret);
        }
        PrintStr("\n");
        PrintStr("\n");
        PrintStr("\n");
        return PrintStart();
    }

    public int PrintSetGray(int nLevel) {
        return Print.Lib_PrnSetGray(nLevel);
    }

    public int PrintSetAlign(int x) {
        return Print.Lib_PrnSetAlign(x);
    }

    public int PrintSetFont(byte fontHeight, byte fontWidth, byte zoom) {
        return Print.Lib_PrnSetFont(fontHeight, fontWidth, zoom);
    }

    public int PrintStr(String str) {
        // v2.11.28: Lib_PrnStr declares UnsupportedEncodingException; never propagate it.
        try {
            return Print.Lib_PrnStr(str);
        } catch (java.io.UnsupportedEncodingException e) {
            e.printStackTrace();
            return -1;
        }
    }

    public int PrintSetLinPixelDis(char iLinDistance) {
        return Print.Lib_SetLinPixelDis(iLinDistance);
    }

    public int PrintStart() {
        int ret = PrintCheckStatus();
        if (ret != 0) {
            return ret;
        }
        int ret2 = Print.Lib_PrnStart();
        if (ret2 != 0) {
            return ret2;
        }
        return ret2;
    }

    public static String readSysBattFile(String sys_path) throws IOException {
        String data = "";
        BufferedReader reader = null;
        try {
            try {
                try {
                    reader = new BufferedReader(new FileReader(sys_path));
                    data = reader.readLine();
                    reader.close();
                } catch (IOException e) {
                    e.printStackTrace();
                    if (reader != null) {
                        reader.close();
                    }
                    return data;
                }
            } catch (IOException e2) {
                e2.printStackTrace();
            }
            return data;
        } catch (Throwable th) {
            if (reader != null) {
                try {
                    reader.close();
                } catch (IOException e3) {
                    e3.printStackTrace();
                }
            }
            throw th;
        }
    }

    public static String readSysBattCat(String sys_path) {
        InputStream is = null;
        InputStreamReader isr = null;
        BufferedReader br = null;
        try {
            try {
                try {
                    Runtime runtime = Runtime.getRuntime();
                    Process process = runtime.exec("cat " + sys_path);
                    is = process.getInputStream();
                    isr = new InputStreamReader(is);
                    br = new BufferedReader(isr);
                    String line = br.readLine();
                    if (line == null) {
                        if (is != null) {
                            try {
                                is.close();
                            } catch (IOException e) {
                                e.printStackTrace();
                            }
                        }
                        try {
                            isr.close();
                        } catch (IOException e2) {
                            e2.printStackTrace();
                        }
                        br.close();
                        return null;
                    }
                    if (is != null) {
                        try {
                            is.close();
                        } catch (IOException e3) {
                            e3.printStackTrace();
                        }
                    }
                    try {
                        isr.close();
                    } catch (IOException e4) {
                        e4.printStackTrace();
                    }
                    try {
                        br.close();
                    } catch (IOException e5) {
                        e5.printStackTrace();
                    }
                    return line;
                } catch (IOException e6) {
                    e6.printStackTrace();
                    if (is != null) {
                        try {
                            is.close();
                        } catch (IOException e7) {
                            e7.printStackTrace();
                        }
                    }
                    if (isr != null) {
                        try {
                            isr.close();
                        } catch (IOException e8) {
                            e8.printStackTrace();
                        }
                    }
                    if (br != null) {
                        br.close();
                    }
                    return null;
                }
            } catch (IOException e9) {
                e9.printStackTrace();
            }
        } catch (Throwable th) {
            if (is != null) {
                try {
                    is.close();
                } catch (IOException e10) {
                    e10.printStackTrace();
                }
            }
            if (isr != null) {
                try {
                    isr.close();
                } catch (IOException e11) {
                    e11.printStackTrace();
                }
            }
            if (br == null) {
                throw th;
            }
            try {
                br.close();
                throw th;
            } catch (IOException e12) {
                e12.printStackTrace();
                throw th;
            }
        }
        return null;
    }

    public int PrintBmp(Bitmap bitmap) {
        return new Print().Lib_PrnBmp(bitmap);
    }

    // v2.11.28: barcode helpers wrap the ZXing checked exceptions instead of propagating them.
    public int PrintBarcode(String contents, int desiredWidth, int desiredHeight, BarcodeFormat barcodeFormat) {
        try {
            return new Print().Lib_PrnBarcode(contents, desiredWidth, desiredHeight, barcodeFormat);
        } catch (Exception e) {
            e.printStackTrace();
            return -1;
        }
    }

    public int PrintQrCode_Cut(String contents, int desiredWidth, int desiredHeight, BarcodeFormat barcodeFormat) {
        try {
            return new Print().printCutQrCode(contents, desiredWidth, desiredHeight, barcodeFormat);
        } catch (Exception e) {
            e.printStackTrace();
            return -1;
        }
    }

    public int PrintCutQrCode_Str(String qrContent, String printTxt, int distance, int desiredWidth, int desiredHeight, BarcodeFormat barcodeFormat) {
        try {
            return new Print().printCutQrCodeStr(qrContent, printTxt, distance, desiredWidth, desiredHeight, barcodeFormat);
        } catch (Exception e) {
            e.printStackTrace();
            return -1;
        }
    }

    public int PciWritePIN_MKey(byte keyNo, byte keyLen, byte[] keyData, byte mode) {
        return Pci.Lib_PciWritePIN_MKey(keyNo, keyLen, keyData, mode);
    }

    public int PciWriteMAC_MKey(byte keyNo, byte keyLen, byte[] keyData, byte mode) {
        return Pci.Lib_PciWriteMAC_MKey(keyNo, keyLen, keyData, mode);
    }

    public int PciWriteDES_MKey(byte keyNo, byte keyLen, byte[] keyData, byte mode) {
        return Pci.Lib_PciWriteDES_MKey(keyNo, keyLen, keyData, mode);
    }

    public int PciWriteDES_KLKKey(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte[] mkey_kcv) {
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteDES_MKey(keyNo, keyLen, keyData, mode);
        Pci.Lib_PciGetTDES(Jmkey_kcv, keyData);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciWriteMAC_KLKKey(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte[] mkey_kcv) {
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteMAC_MKey(keyNo, keyLen, keyData, mode);
        Pci.Lib_PciGetTDES(Jmkey_kcv, keyData);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciWritePIN_KLKKey(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte[] mkey_kcv) {
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWritePIN_MKey(keyNo, keyLen, keyData, mode);
        Pci.Lib_PciGetTDES(Jmkey_kcv, keyData);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciWritePinKey(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo) {
        return Pci.Lib_PciWritePinKey(keyNo, keyLen, keyData, mode, mkeyNo);
    }

    public int PciWritePinKey_HostMK(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo, byte[] mkey_kcv) {
        byte[] deskey = new byte[32];
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            deskey[i] = 0;
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteKLKPinKey(keyNo, keyLen, keyData, mode, mkeyNo, deskey, (byte) 0);
        Pci.Lib_PciGetTDES(Jmkey_kcv, deskey);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciWriteDesKey_HostMK(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo, byte[] mkey_kcv) {
        byte[] deskey = new byte[32];
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            deskey[i] = 0;
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteKLKDesKey(keyNo, keyLen, keyData, mode, mkeyNo, deskey, (byte) 0);
        Pci.Lib_PciGetTDES(Jmkey_kcv, deskey);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciWriteMacKey_HostMK(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo, byte[] mkey_kcv) {
        byte[] deskey = new byte[32];
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            deskey[i] = 0;
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteKLKMacKey(keyNo, keyLen, keyData, mode, mkeyNo, deskey, (byte) 0);
        Pci.Lib_PciGetTDES(Jmkey_kcv, deskey);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciWriteMacKey(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo) {
        return Pci.Lib_PciWriteMacKey(keyNo, keyLen, keyData, mode, mkeyNo);
    }

    public int PciWriteDesKey(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo) {
        return Pci.Lib_PciWriteDesKey(keyNo, keyLen, keyData, mode, mkeyNo);
    }

    public int PciWriteMacKey_HostWK(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo, byte[] mkey_kcv) {
        byte[] deskey = new byte[32];
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            deskey[i] = 0;
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteKLKMacKey(keyNo, keyLen, keyData, mode, mkeyNo, deskey, (byte) 1);
        Pci.Lib_PciGetTDES(Jmkey_kcv, deskey);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciWriteDesKey_HostWK(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo, byte[] mkey_kcv) {
        byte[] deskey = new byte[32];
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            deskey[i] = 0;
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteKLKDesKey(keyNo, keyLen, keyData, mode, mkeyNo, deskey, (byte) 1);
        Pci.Lib_PciGetTDES(Jmkey_kcv, deskey);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciReadKcv(byte mkey_no, byte key_type, byte[] jmkey_kcv) {
        Pci.Lib_PciReadKcv(mkey_no, key_type, jmkey_kcv);
        return 0;
    }

    public int PciWritePinKey_HostWK(byte keyNo, byte keyLen, byte[] keyData, byte mode, byte mkeyNo, byte[] mkey_kcv) {
        byte[] deskey = new byte[32];
        byte[] Jmkey_kcv = new byte[32];
        for (int i = 0; i < 32; i++) {
            deskey[i] = 0;
            Jmkey_kcv[i] = 0;
        }
        Pci.Lib_PciWriteKLKPinKey(keyNo, keyLen, keyData, mode, mkeyNo, deskey, (byte) 1);
        Pci.Lib_PciGetTDES(Jmkey_kcv, deskey);
        for (int i2 = 0; i2 < 32; i2++) {
            mkey_kcv[i2] = Jmkey_kcv[i2];
        }
        return 0;
    }

    public int PciGetPin(byte keyNo, byte minLen, byte maxLen, byte mode, byte[] cardNo, byte[] pinBlock, byte[] pinPasswd, byte pin_len, byte mark, byte[] iAmount, byte waitTimeSec, Context ctx) {
        return Pci.Lib_PciGetPin(keyNo, minLen, maxLen, mode, cardNo, pinBlock, pinPasswd, pin_len, mark, iAmount, waitTimeSec, ctx);
    }

    public int PciGetKLKPin(byte keyNo, byte minLen, byte maxLen, byte mode, byte[] cardNo, byte[] pinBlock, byte[] pinPasswd, byte pin_len, byte mark, byte[] iAmount, byte waitTimeSec, Context ctx) {
        return Pci.Lib_PciGetKLKPin(keyNo, minLen, maxLen, mode, cardNo, pinBlock, pinPasswd, pin_len, mark, iAmount, waitTimeSec, ctx);
    }

    public int PciGetMac(byte keyNo, short inLen, byte[] inData, byte[] macOut, byte mode) {
        return Pci.Lib_PciGetMac(keyNo, inLen, inData, macOut, mode);
    }

    public int PciGetKLKMac(byte keyNo, short inLen, byte[] inData, byte[] macOut, byte mode) {
        return Pci.Lib_PciGetKLKMac(keyNo, inLen, inData, macOut, mode);
    }

    public int PciGetSelPalMac(byte keyNo, short inLen, byte[] inData, byte[] macOut, byte mode) {
        return Pci.Lib_PciGetSelPalMac(keyNo, inLen, inData, macOut, mode);
    }

    public int PciGetDes(byte keyNo, short inLen, byte[] inData, byte[] outData, byte mode) {
        return Pci.Lib_PciGetDes(keyNo, inLen, inData, outData, mode);
    }

    public int PciGetKLKDes(byte keyNo, short inLen, byte[] inData, byte[] outData, byte mode) {
        return Pci.Lib_PciGetKLKDes(keyNo, inLen, inData, outData, mode);
    }

    public int PciGetSelPalDes(byte keyNo, short inLen, byte[] inData, byte[] outData, byte mode) {
        return Pci.Lib_PciGetSelPalDes(keyNo, inLen, inData, outData, mode);
    }

    public int PciTriDes(int Flag, int Mode, byte[] IV, byte[] key, int KeyType, byte[] Src, int SrcLen, byte[] Out) {
        Log.e("PciTriDes", "PciTriDes: ---into");
        return Pci.Lib_PciTriDesHandle(Flag, Mode, IV, key, KeyType, Src, SrcLen, Out);
    }

    public int PciGetRnd(byte[] rnd) {
        return Pci.Lib_PciGetRnd(rnd);
    }

    public int PciGetKcv(byte[] output, byte[] deskey) {
        return Pci.Lib_PciGetTDES(output, deskey);
    }

    public int PciRsaGenKeyPair(int uiKeyBits, byte[] n, byte[] p, byte[] q, byte[] d) {
        return Pci.Lib_PciRsaGenKeyPair(uiKeyBits, n, p, q, d);
    }

    public int PciRsaEncrypt(int uiKeyBits, byte[] n, byte[] PLAINTEXT, byte[] CIPHERTEXT) {
        return Pci.Lib_PciRsaEncrypt(uiKeyBits, n, PLAINTEXT, CIPHERTEXT);
    }

    public int PciRsaDecrypt(int uiKeyBits, byte[] n, byte[] d, byte[] CIPHERTEXT, byte[] PLAINTEXT) {
        return Pci.Lib_PciRsaDecrypt(uiKeyBits, n, d, PLAINTEXT, CIPHERTEXT);
    }

    public int PciAesHandle(int Flag, int Mode, byte[] IV, byte[] key, int KeyType, byte[] Src, int SrcLen, byte[] Out) {
        return Pci.Lib_PciAesHandle(Flag, Mode, IV, key, KeyType, Src, SrcLen, Out);
    }

    public int SysUpdate() {
        return Sys.Lib_Update();
    }

    public int SysSetLedMode(int ledIndex, int mode) {
        return Sys.Lib_SetLed((byte) ledIndex, (byte) mode);
    }

    public int SysLogSwitch(int LogSwitch) {
        PaySys.LogTurnOn(LogSwitch);
        return Sys.Lib_LogSwitch(LogSwitch);
    }

    public int SysBeep() {
        return Sys.Lib_Beep();
    }

    public int SysReadChipID(byte[] buf, int len) {
        return Sys.Lib_ReadChipID(buf, len);
    }

    public int SysWriteSN(byte[] SN) {
        return Sys.Lib_WriteSN(SN);
    }

    public int RsaEncrypt(byte[] Jni_pKey, int Jni_uKeyLen, byte[] jni_pInData, int jni_uInLen, byte[] jni_pOutData) {
        return Sys.Lib_RsaEncrypt(Jni_pKey, Jni_uKeyLen, jni_pInData, jni_uInLen, jni_pOutData);
    }

    public int RsaDecrypt(byte[] Jni_pKeyN, int Jni_uKeyLenN, byte[] jni_pKeyD, byte[] jni_pInData, int jni_uInLen, byte[] jni_pOutData) {
        return Sys.Lib_RsaDecrypt(Jni_pKeyN, Jni_uKeyLenN, jni_pKeyD, jni_pInData, jni_uInLen, jni_pOutData);
    }

    public int SysReadSN(byte[] SN) {
        return Sys.Lib_ReadSN(SN);
    }

    public int SysGetVersion(byte[] buf) {
        return Sys.Lib_GetVersion(buf);
    }

    public void SetKeyScanByLetfVolume(Context mContext, int mode) {
        Intent intent = new Intent(SET_LEFT_VOLUME_KEY_SCAN);
        intent.putExtra("value", mode);
        mContext.sendBroadcast(intent);
    }

    public void SetKeyScanByRightVolume(Context mContext, int mode) {
        Intent intent = new Intent(SET_RIGHT_VOLUME_KEY_SCAN);
        intent.putExtra("value", mode);
        mContext.sendBroadcast(intent);
    }

    public String getAARVersion() {
        return AAR_VERSION;
    }

    public String getOSVersion(Context context) {
        return Settings.System.getString(context.getContentResolver(), "custom_build_version");
    }

    public String getMcuTargetVersion(Context context) {
        return Settings.System.getString(context.getContentResolver(), "mcu_target_version");
    }

    public static Object getBCRService() {
        try {
            Class<?> cls = Class.forName("android.os.ServiceManager");
            Method method = cls.getMethod("getService", String.class);
            IBinder b = (IBinder) method.invoke(cls.newInstance(), "bcr_service");
            Class<?> stub = Class.forName("com.android.server.bcr.IBCRService$Stub");
            Method asInterfaceMethod = stub.getDeclaredMethod("asInterface", IBinder.class);
            return asInterfaceMethod.invoke(stub, b);
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    public static boolean installRomPackage(Context context, String romFilePath) {
        Log.e("RomUtil", "installRomPackage - s");
        try {
            if (mBCRService == null) {
                mBCRService = getBCRService();
            }
            Method installPackage = mBCRService.getClass().getDeclaredMethod("installPackage", String.class);
            Log.e("RomUtil", "installPackage - ***********************" + ((Boolean) installPackage.invoke(mBCRService, romFilePath)));
            return ((Boolean) installPackage.invoke(mBCRService, romFilePath)).booleanValue();
        } catch (Exception e) {
            Log.e("RomUtil", "installRomPackage :" + e.getMessage());
            e.printStackTrace();
            return false;
        }
    }

    public int PciEncryptPin(byte keyNo, short inLen, byte[] inData, byte[] outData) {
        return Pci.Lib_PciEncryptPin(keyNo, inLen, inData, outData);
    }
}
