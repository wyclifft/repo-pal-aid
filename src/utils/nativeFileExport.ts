/**
 * Cross-platform file export utility
 *
 * Web: triggers a browser download via anchor element.
 * Native (Android/iOS): writes to the app's Documents directory using
 * Capacitor Filesystem, then opens the system Share sheet so the user can
 * save to Downloads, send via email/WhatsApp, etc.
 *
 * This fixes the silent failure of anchor-downloads inside Capacitor WebViews.
 */
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function saveExportedFile(
  filename: string,
  content: string,
  mimeType: string
): Promise<void> {
  // ---- Web fallback --------------------------------------------------------
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  // ---- Native: write to Documents ------------------------------------------
  const path = `exports/${filename}`;
  await Filesystem.writeFile({
    path,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  const uriResult = await Filesystem.getUri({
    path,
    directory: Directory.Documents,
  });

  // Open system share sheet so user can save to Downloads, email, etc.
  try {
    await Share.share({
      files: [uriResult.uri],
      title: `Export: ${filename}`,
      dialogTitle: "Save exported file",
    });
  } catch {
    // Share may be cancelled or no apps available — file is still saved locally.
    // We intentionally swallow; caller can toast success regardless.
  }
}
