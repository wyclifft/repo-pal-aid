package vpos.apipackage;

import android.os.Environment;
import java.io.File;
import java.io.RandomAccessFile;

/* JADX INFO: loaded from: classes.dex */
public class FileTools {
    public static String DIR = Environment.getExternalStorageDirectory().getPath() + "/";

    public static void write(String fileName, long seekto, String content) {
        try {
            File file = new File(DIR + "PayPassConfig");
            if (!file.exists()) {
                file.mkdirs();
            }
            File dir = new File(DIR + fileName);
            if (!dir.exists()) {
                dir.createNewFile();
                RandomAccessFile raf = new RandomAccessFile(dir, "rw");
                raf.seek(seekto);
                raf.write(content.getBytes());
                raf.close();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static String read(String fileName, long seekto) {
        try {
            File dir = new File(DIR + fileName);
            if (!dir.exists()) {
                return "  ";
            }
            RandomAccessFile raf = new RandomAccessFile(dir, "rw");
            byte[] bytes = new byte[(int) dir.length()];
            raf.seek(seekto);
            raf.read(bytes);
            raf.close();
            String str = new String(bytes);
            return str;
        } catch (Exception e) {
            e.printStackTrace();
            return "";
        }
    }
}
