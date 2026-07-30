package vpos.apipackage;

import android.annotation.SuppressLint;
import android.support.v4.internal.view.SupportMenu;
import android.support.v4.view.ViewCompat;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;

/* JADX INFO: loaded from: classes.dex */
@SuppressLint({"UseValueOf"})
public class ByteUtil {
    private ByteUtil() {
        System.out.println("ByteUtil Constructor");
    }

    public static int returnActualLength(byte[] data) {
        int i = 0;
        while (i < data.length && data[i] != 0) {
            i++;
        }
        return i;
    }

    public static byte[] iToBytes(int n) {
        try {
            ByteArrayOutputStream byteOut = new ByteArrayOutputStream();
            DataOutputStream dataOut = new DataOutputStream(byteOut);
            dataOut.writeInt(n);
            byte[] byteArray = byteOut.toByteArray();
            return byteArray;
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    public static int bytesToInt(byte[] byteArray) {
        try {
            ByteArrayInputStream byteInput = new ByteArrayInputStream(byteArray);
            DataInputStream dataInput = new DataInputStream(byteInput);
            int n = dataInput.readInt();
            return n;
        } catch (IOException e) {
            e.printStackTrace();
            return 0;
        }
    }

    public byte[] IntToByteArray(int n) {
        byte[] b = {(byte) (n & 255), (byte) ((n >> 8) & 255), (byte) ((n >> 16) & 255), (byte) ((n >> 24) & 255)};
        return b;
    }

    public int ByteArrayToInt(byte[] bArr) {
        if (bArr.length != 4) {
            return -1;
        }
        return ((bArr[3] & 255) << 24) | ((bArr[2] & 255) << 16) | ((bArr[1] & 255) << 8) | ((bArr[0] & 255) << 0);
    }

    public static String bytesToString(byte[] b) {
        StringBuffer result = new StringBuffer("");
        for (byte b2 : b) {
            char ch = (char) (b2 & 255);
            if (ch == 0) {
                break;
            }
            result.append(ch);
        }
        return result.toString();
    }

    public static String bytearrayToHexString(byte[] b, int leng) {
        StringBuffer strbuf = new StringBuffer();
        for (int i = 0; i < leng; i++) {
            strbuf.append("0123456789ABCDEF".charAt((byte) ((b[i] & 240) >> 4)));
            strbuf.append("0123456789ABCDEF".charAt((byte) (b[i] & 15)));
            strbuf.append(" ");
        }
        return strbuf.toString();
    }

    public static byte[] stringToBytes(String s) {
        return s.getBytes();
    }

    public static void ShortToBytes(byte[] b, short x, int offset) {
        if (b.length - offset >= 2) {
            b[offset + 1] = (byte) (x >> 8);
            b[offset + 0] = (byte) (x >> 0);
        }
    }

    public static short BytesToShort(byte[] b, int offset) {
        if (b.length - offset < 2) {
            return (short) 0;
        }
        short x = (short) ((b[offset + 1] << 8) | (b[offset + 0] & 255));
        return x;
    }

    public static String byteToHexString(byte b) {
        StringBuffer sbBuffer = new StringBuffer();
        sbBuffer.append("0123456789ABCDEF".charAt((b >> 4) & 15));
        sbBuffer.append("0123456789ABCDEF".charAt(b & 15));
        return sbBuffer.toString();
    }

    public static void IntToBytes(byte[] b, int x, int offset) {
        if (b.length - offset >= 4) {
            b[offset + 3] = (byte) (x >> 24);
            b[offset + 2] = (byte) (x >> 16);
            b[offset + 1] = (byte) (x >> 8);
            b[offset + 0] = (byte) (x >> 0);
        }
    }

    public static int BytesToInt(byte[] b, int offset) {
        if (b.length - offset < 4) {
            return 0;
        }
        int x = ((b[offset + 3] & 255) << 24) | ((b[offset + 2] & 255) << 16) | ((b[offset + 1] & 255) << 8) | ((b[offset + 0] & 255) << 0);
        return x;
    }

    public static void LongToBytes(byte[] b, long x, int offset) {
        if (b.length - offset >= 8) {
            b[offset + 7] = (byte) (x >> 56);
            b[offset + 6] = (byte) (x >> 48);
            b[offset + 5] = (byte) (x >> 40);
            b[offset + 4] = (byte) (x >> 32);
            b[offset + 3] = (byte) (x >> 24);
            b[offset + 2] = (byte) (x >> 16);
            b[offset + 1] = (byte) (x >> 8);
            b[offset + 0] = (byte) (x >> 0);
        }
    }

    public static long BytesToLong(byte[] b, int offset) {
        if (b.length - offset < 8) {
            return 0L;
        }
        long x = ((((long) b[offset + 1]) & 255) << 8) | ((((long) b[offset + 7]) & 255) << 56) | ((((long) b[offset + 6]) & 255) << 48) | ((((long) b[offset + 5]) & 255) << 40) | ((((long) b[offset + 4]) & 255) << 32) | ((((long) b[offset + 3]) & 255) << 24) | ((((long) b[offset + 2]) & 255) << 16) | ((((long) b[offset + 0]) & 255) << 0);
        return x;
    }

    public static void CharToBytes(byte[] b, char ch, int offset) {
        if (b.length - offset >= 2) {
            int temp = ch;
            for (int i = 0; i < 2; i++) {
                b[offset + i] = new Integer(temp & 255).byteValue();
                temp >>= 8;
            }
        }
    }

    public static char BytesToChar(byte[] b, int offset) {
        int s = 0;
        if (b.length - offset >= 2) {
            int s2 = b[offset + 1] > 0 ? 0 + b[offset + 1] : 0 + b[offset + 0] + 256;
            int s3 = s2 * 256;
            if (b[offset + 0] > 0) {
                s = s3 + b[offset + 1];
            } else {
                s = s3 + b[offset + 0] + 256;
            }
        }
        char ch = (char) s;
        return ch;
    }

    public static void FloatToBytes(byte[] b, float x, int offset) {
        if (b.length - offset >= 4) {
            int l = Float.floatToIntBits(x);
            for (int i = 0; i < 4; i++) {
                b[offset + i] = new Integer(l).byteValue();
                l >>= 8;
            }
        }
    }

    public static float BytesToFloat(byte[] b, int offset) {
        int l = 0;
        if (b.length - offset >= 4) {
            int l2 = b[offset + 0];
            l = (int) (((long) (((int) (((long) (((int) (((long) (l2 & 255)) | (((long) b[offset + 1]) << 8))) & SupportMenu.USER_MASK)) | (((long) b[offset + 2]) << 16))) & ViewCompat.MEASURED_SIZE_MASK)) | (((long) b[offset + 3]) << 24));
        }
        return Float.intBitsToFloat(l);
    }

    public static void DoubleToBytes(byte[] b, double x, int offset) {
        if (b.length - offset >= 8) {
            long l = Double.doubleToLongBits(x);
            for (int i = 0; i < 4; i++) {
                b[offset + i] = new Long(l).byteValue();
                l >>= 8;
            }
        }
    }

    public static double BytesToDouble(byte[] b, int offset) {
        long l = 0;
        if (b.length - offset >= 8) {
            long l2 = b[0];
            l = (((((((((((((l2 & 255) | (((long) b[1]) << 8)) & 65535) | (((long) b[2]) << 16)) & 16777215) | (((long) b[3]) << 24)) & 4294967295L) | (((long) b[4]) << 32)) & 1099511627775L) | (((long) b[5]) << 40)) & 281474976710655L) | (((long) b[6]) << 48)) & 72057594037927935L) | (((long) b[7]) << 56);
        }
        return Double.longBitsToDouble(l);
    }

    public static short toLH(short n) {
        byte[] b = {(byte) (n & 255), (byte) ((n >> 8) & 255)};
        short ret = BytesToShort(b, 0);
        return ret;
    }

    public static short toHL(short n) {
        byte[] b = {(byte) ((n >> 8) & 255), (byte) (n & 255)};
        short ret = BytesToShort(b, 0);
        return ret;
    }

    public static int toLH(int n) {
        byte[] b = {(byte) (n & 255), (byte) ((n >> 8) & 255), (byte) ((n >> 16) & 255), (byte) ((n >> 24) & 255)};
        int ret = BytesToInt(b, 0);
        return ret;
    }

    public static int toHL(int n) {
        byte[] b = {(byte) ((n >> 24) & 255), (byte) ((n >> 16) & 255), (byte) ((n >> 8) & 255), (byte) (n & 255)};
        int ret = BytesToInt(b, 0);
        return ret;
    }

    public static long toLH(long n) {
        byte[] b = {(byte) (n & 255), (byte) ((n >> 8) & 255), (byte) ((n >> 16) & 255), (byte) ((n >> 24) & 255), (byte) ((n >> 32) & 255), (byte) ((n >> 40) & 255), (byte) ((n >> 48) & 255), (byte) (255 & (n >> 56))};
        long ret = BytesToLong(b, 0);
        return ret;
    }

    public static long toHL(long n) {
        byte[] b = {(byte) (255 & (n >> 56)), (byte) ((n >> 48) & 255), (byte) ((n >> 40) & 255), (byte) ((n >> 32) & 255), (byte) ((n >> 24) & 255), (byte) ((n >> 16) & 255), (byte) ((n >> 8) & 255), (byte) (n & 255)};
        long ret = BytesToLong(b, 0);
        return ret;
    }

    public static void encodeOutputBytes(byte[] b, short sLen) {
        if (b.length >= sLen + 2) {
            System.arraycopy(b, 0, b, 2, sLen);
            byte[] byShort = new byte[2];
            ShortToBytes(byShort, sLen, 0);
            System.arraycopy(byShort, 0, b, 0, byShort.length);
        }
    }

    public static short decodeOutputBytes(byte[] b) {
        byte[] byShort = new byte[2];
        System.arraycopy(b, 0, byShort, 0, byShort.length);
        short sLen = BytesToShort(byShort, 0);
        System.arraycopy(b, 2, b, 0, sLen);
        return sLen;
    }

    public static String hexStr2Str(String hexStr) {
        char[] hexs = hexStr.toCharArray();
        byte[] bytes = new byte[hexStr.length() / 2];
        for (int i = 0; i < bytes.length; i++) {
            int n = "0123456789ABCDEF".indexOf(hexs[i * 2]) * 16;
            bytes[i] = (byte) ((n + "0123456789ABCDEF".indexOf(hexs[(i * 2) + 1])) & 255);
        }
        return new String(bytes);
    }
}
