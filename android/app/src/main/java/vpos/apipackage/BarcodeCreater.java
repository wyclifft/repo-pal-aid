package vpos.apipackage;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PointF;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;

/* JADX INFO: loaded from: classes.dex */
public abstract class BarcodeCreater {
    private static int marginW = 20;
    private static BarcodeFormat barcodeFormat = BarcodeFormat.CODE_128;

    public static Bitmap creatBarcode(Context context, String contents, int desiredWidth, int desiredHeight, boolean displayCode) throws WriterException {
        if (displayCode) {
            Bitmap barcodeBitmap = encodeAsBitmap(contents, barcodeFormat, desiredWidth, desiredHeight);
            Bitmap codeBitmap = creatCodeBitmap(contents, (marginW * 2) + desiredWidth, desiredHeight, context);
            Bitmap ruseltBitmap = mixtureBitmap(barcodeBitmap, codeBitmap, new PointF(0.0f, desiredHeight));
            return ruseltBitmap;
        }
        Bitmap ruseltBitmap2 = encodeAsBitmap(contents, barcodeFormat, desiredWidth, desiredHeight);
        return ruseltBitmap2;
    }

    public static Bitmap creatBarcode(String contents, int desiredWidth, int desiredHeight, BarcodeFormat barcodeFormat2) throws WriterException {
        Bitmap ruseltBitmap = encodeAsBitmap(contents, barcodeFormat2, desiredWidth, desiredHeight);
        return ruseltBitmap;
    }

    protected static Bitmap creatCodeBitmap(String contents, int width, int height, Context context) {
        TextView tv = new TextView(context);
        LinearLayout.LayoutParams layoutParams = new LinearLayout.LayoutParams(-1, -2);
        tv.setLayoutParams(layoutParams);
        tv.setText(contents);
        tv.setHeight(height);
        tv.setGravity(1);
        tv.setWidth(width);
        tv.setDrawingCacheEnabled(true);
        tv.setTextColor(0xff000000);
        tv.measure(View.MeasureSpec.makeMeasureSpec(0, 0), View.MeasureSpec.makeMeasureSpec(0, 0));
        tv.layout(0, 0, tv.getMeasuredWidth(), tv.getMeasuredHeight());
        tv.buildDrawingCache();
        Bitmap bitmapCode = tv.getDrawingCache();
        return bitmapCode;
    }

    protected static Bitmap encodeAsBitmap(String contents, BarcodeFormat format, int desiredWidth, int desiredHeight) throws WriterException {
        MultiFormatWriter writer = new MultiFormatWriter();
        BitMatrix result = null;
        try {
            result = writer.encode(contents, format, desiredWidth, desiredHeight, null);
        } catch (WriterException e) {
            e.printStackTrace();
        }
        int width = result.getWidth();
        int height = result.getHeight();
        int[] pixels = new int[width * height];
        for (int y = 0; y < height; y++) {
            int offset = y * width;
            for (int x = 0; x < width; x++) {
                pixels[offset + x] = result.get(x, y) ? 0xff000000 : -1;
            }
        }
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height);
        return bitmap;
    }

    protected static Bitmap mixtureBitmap(Bitmap first, Bitmap second, PointF fromPoint) {
        if (first == null || second == null || fromPoint == null) {
            return null;
        }
        Bitmap newBitmap = Bitmap.createBitmap(first.getWidth() + second.getWidth() + marginW, first.getHeight() + second.getHeight(), Bitmap.Config.ARGB_4444);
        Canvas cv = new Canvas(newBitmap);
        cv.drawBitmap(first, marginW, 0.0f, (Paint) null);
        cv.drawBitmap(second, fromPoint.x, fromPoint.y, (Paint) null);
        cv.save(31);
        cv.restore();
        return newBitmap;
    }
}
