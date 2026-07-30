package vpos.apipackage;

import java.io.UnsupportedEncodingException;

/* JADX INFO: loaded from: classes.dex */
public class StringUtil {
    private StringUtil() {
        System.out.println("StringUtil Constructor");
    }

    private static byte charToByte(char c) {
        return (byte) "0123456789ABCDEF".indexOf(c);
    }

    public static String bytesToHexString(byte[] src, int len) {
        StringBuilder stringBuilder = new StringBuilder("");
        if (src == null || src.length <= 0) {
            return null;
        }
        for (int i = 0; i < len; i++) {
            int v = src[i] & 255;
            String hv = Integer.toHexString(v);
            if (hv.length() < 2) {
                stringBuilder.append(0);
            }
            stringBuilder.append(hv);
        }
        return stringBuilder.toString();
    }

    public static byte[] hexStringToBytes(String hexString) {
        if (hexString == null || hexString.equals("")) {
            return null;
        }
        String hexString2 = hexString.toUpperCase();
        int length = hexString2.length() / 2;
        char[] hexChars = hexString2.toCharArray();
        byte[] by = new byte[length];
        for (int i = 0; i < length; i++) {
            int pos = i * 2;
            by[i] = (byte) ((charToByte(hexChars[pos]) << 4) | charToByte(hexChars[pos + 1]));
        }
        return by;
    }

    public static byte[] getBytesFromString(String src, String charset) {
        try {
            byte[] retByte = src.getBytes(charset);
            return retByte;
        } catch (UnsupportedEncodingException e) {
            e.printStackTrace();
            return null;
        }
    }

    public static String setBytesToString(byte[] src, String charset) {
        try {
            String retString = new String(src, charset);
            return retString;
        } catch (UnsupportedEncodingException e) {
            e.printStackTrace();
            return "";
        }
    }

    public static String UTF8ToGBK(String utf8String) {
        byte[] byGBK = getBytesFromString(utf8String, "gbk");
        String gbkString = setBytesToString(byGBK, "gbk");
        return gbkString;
    }

    public static String GBKToUTF8(String gbkString) {
        byte[] byUTF8 = getBytesFromString(gbkString, "utf-8");
        String utf8String = setBytesToString(byUTF8, "utf-8");
        return utf8String;
    }

    public static void printBytes(byte[] b) {
        int length = b.length;
        System.out.print(String.format("length: %d, bytes: ", Integer.valueOf(length)));
        for (byte b2 : b) {
            System.out.print(String.format("%02X ", Byte.valueOf(b2)));
        }
        System.out.println("");
    }

    public static void printBytes(byte[] b, int len) {
        System.out.print(String.format("length: %d, bytes: ", Integer.valueOf(len)));
        for (int i = 0; i < len; i++) {
            System.out.print(String.format("%02X ", Byte.valueOf(b[i])));
        }
        System.out.println("");
    }
}
