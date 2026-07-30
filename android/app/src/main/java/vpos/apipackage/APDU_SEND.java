package vpos.apipackage;

/* JADX INFO: loaded from: classes.dex */
public class APDU_SEND {
    public byte[] Command;
    public byte[] DataIn;
    public short Lc;
    public short Le;

    public APDU_SEND(byte[] Command, short Lc, byte[] DataIn, short Le) {
        this.Command = null;
        this.DataIn = null;
        this.Command = new byte[Command.length];
        this.DataIn = new byte[DataIn.length];
        this.Command = Command;
        this.Lc = Lc;
        this.DataIn = DataIn;
        this.Le = Le;
    }

    public byte[] getBytes() {
        byte[] buf = new byte[520];
        System.arraycopy(this.Command, 0, buf, 0, this.Command.length);
        buf[4] = (byte) (this.Lc / 256);
        buf[5] = (byte) (this.Lc % 256);
        System.arraycopy(this.DataIn, 0, buf, 6, this.DataIn.length);
        buf[518] = (byte) (this.Le / 256);
        buf[519] = (byte) (this.Le % 256);
        return buf;
    }
}
