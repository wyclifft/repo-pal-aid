package vpos.util;

/**
 * v2.11.28: Minimal replacement for the vendor's vpos.util.Util helper.
 * Only sleepMs() is referenced by the recovered SDK (PosApiHelper.SetMcuPowerMode).
 */
public final class Util {

    private Util() {
    }

    /** Sleep without propagating InterruptedException, matching vendor behaviour. */
    public static void sleepMs(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
