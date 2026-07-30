package vpos.apipackage;

/* JADX INFO: loaded from: classes.dex */
public class APDU_RESP {
    public byte[] DataOut;
    public short LenOut;
    public byte SWA;
    public byte SWB;

    public APDU_RESP() {
        this.LenOut = (short) 0;
        this.DataOut = new byte[512];
        this.SWA = (byte) 0;
        this.SWB = (byte) 0;
    }

    public APDU_RESP(short LenOut, byte[] DataOut, byte SWA, byte SWB) {
        this.LenOut = (short) 0;
        this.DataOut = new byte[512];
        this.SWA = (byte) 0;
        this.SWB = (byte) 0;
        this.LenOut = LenOut;
        this.DataOut = DataOut;
        this.SWA = SWA;
        this.SWB = SWB;
    }

    public APDU_RESP(byte[] resp) {
        this.LenOut = (short) 0;
        this.DataOut = new byte[512];
        this.SWA = (byte) 0;
        this.SWB = (byte) 0;
        this.LenOut = (short) (((resp[1] & 255) * 256) + (resp[0] & 255));
        System.arraycopy(resp, 2, this.DataOut, 0, 512);
        this.SWA = resp[514];
        this.SWB = resp[515];
    }

    public short getLenOut() {
        return this.LenOut;
    }

    public byte[] getDataOut() {
        return this.DataOut;
    }

    public byte getSWA() {
        return this.SWA;
    }

    public byte getSWB() {
        return this.SWB;
    }
}
