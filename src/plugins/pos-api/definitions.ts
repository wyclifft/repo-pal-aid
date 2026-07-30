// v2.11.27: TypeScript surface for the native PosApiPlugin (Android).
// Every method mirrors a method exported by android/.../posapi/PosApiPlugin.java.
// The plugin lives inside the app module (not a standalone package) and is
// registered by MainActivity.kt.

export type PosErrorCode =
  | 'NO_PAPER'
  | 'PRINTER_OVERHEATED'
  | 'LOW_BATTERY'
  | 'NOT_INITIALIZED'
  | 'HARDWARE_UNAVAILABLE'
  | 'INVALID_ARGUMENT'
  | 'UNIMPLEMENTED_ON_WEB'
  | 'TIMEOUT'
  | `POS_ERR_${number}`
  | 'POS_ERR';

export interface PosResult {
  ok: true;
  rc: number;
  data?: string;
  bytes?: string;   // base64
  track1?: string;
  track2?: string;
  track3?: string;
}

export interface PosReadyResult {
  ok: true;
  ready: boolean;
  /** v2.11.29: native init lifecycle — 'ok' | 'pending' | 'failed' | 'web'. */
  state?: string;
  error?: string;
}


export interface PosApiPlugin {
  // --- system
  beep(): Promise<PosResult>;
  powerOn(): Promise<PosResult>;
  powerOff(): Promise<PosResult>;
  getVersion(): Promise<PosResult>;
  getSerial(): Promise<PosResult>;
  getChipId(): Promise<PosResult>;
  getTime(): Promise<PosResult>;
  setTime(opts: { value: string }): Promise<PosResult>;
  setLog(opts: { on: 0 | 1 }): Promise<PosResult>;
  setLed(opts: { index: number; state: number }): Promise<PosResult>;
  setEntryMode(opts: { open: boolean }): Promise<PosResult>;
  isReady(): Promise<PosReadyResult>;

  // --- printer
  initializePrinter(): Promise<PosResult>;
  printText(opts: { text: string }): Promise<PosResult>;
  startPrint(): Promise<PosResult>;
  printReceipt(opts: { lines: string[] }): Promise<PosResult>;
  closePrinter(): Promise<{ ok: true }>;
  printerStatus(): Promise<PosResult>;

  // --- ICC
  openCard(): Promise<PosResult>;
  closeCard(): Promise<PosResult>;
  checkCard(): Promise<PosResult>;
  sendApdu(opts: { apdu: string; mode?: 'icc' | 'picc' }): Promise<PosResult>;

  // --- NFC / PICC
  openNfc(): Promise<PosResult>;
  closeNfc(): Promise<PosResult>;
  detectCard(): Promise<PosResult>;
  removeCard(): Promise<PosResult>;
  resetCard(): Promise<PosResult>;
  entryPoint(): Promise<PosResult>;

  // --- MSR
  openMag(): Promise<PosResult>;
  closeMag(): Promise<PosResult>;
  resetMag(): Promise<PosResult>;
  checkMag(): Promise<PosResult>;
  readMagStripe(): Promise<PosResult>;

  // --- Scanner
  openScanner(): Promise<PosResult>;
  closeScanner(): Promise<PosResult>;
  scan(opts?: { timeoutMs?: number }): Promise<PosResult>;

  // --- PIN pad
  setTimeout(opts: { seconds: number }): Promise<PosResult>;
  setPinType(opts: { type: number }): Promise<PosResult>;
  enterPin(): Promise<PosResult>;
  getPinBlock(opts: { pan: string; klk?: boolean }): Promise<PosResult>;

  // --- EMV
  initEmv(): Promise<PosResult>;
  startTransaction(): Promise<PosResult>;
  completeTransaction(opts?: { online?: number }): Promise<PosResult>;
  getEmvVersion(): Promise<PosResult>;
  setAmount(opts: { amount: number }): Promise<PosResult>;
  setTransactionType(opts: { type: number }): Promise<PosResult>;
  setCardType(opts: { type: number }): Promise<PosResult>;
  setOnlineResult(opts: { result: number }): Promise<PosResult>;
  prepareField55(): Promise<PosResult>;
  getTag(opts: { tag: number }): Promise<PosResult>;
  loadAid(opts: { data: string }): Promise<PosResult>;
  loadCapk(opts: { data: string }): Promise<PosResult>;
  saveTermParas(opts: { data: string }): Promise<PosResult>;
  clearAllAids(): Promise<PosResult>;
  clearAllCapks(): Promise<PosResult>;

  // --- Fingerprint
  openFingerprint(): Promise<PosResult>;
  closeFingerprint(): Promise<PosResult>;
  captureFingerprint(opts?: { id?: number }): Promise<PosResult>;
  matchFingerprint(): Promise<PosResult>;
  getFingerprintCode(): Promise<PosResult>;
  deleteFingerprints(): Promise<PosResult>;

  // --- ID Card
  openIdReader(): Promise<PosResult>;
  closeIdReader(): Promise<PosResult>;
  readId(opts?: { withFingerprint?: boolean }): Promise<PosResult>;

  // --- Serial
  send(opts: { port?: number; data: string }): Promise<PosResult>;
  receive(opts?: { port?: number; max?: number; timeoutMs?: number }): Promise<PosResult>;
}
