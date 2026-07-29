// v2.11.27: Web fallback for PosApi. All methods reject with
// UNIMPLEMENTED_ON_WEB so browser dev keeps compiling.
import { WebPlugin } from '@capacitor/core';
import type { PosApiPlugin, PosResult, PosReadyResult } from './definitions';

const unavailable = async (): Promise<never> => {
  throw new Error('UNIMPLEMENTED_ON_WEB: PosApi only runs on native Android.');
};

const unavailableResult = unavailable as unknown as () => Promise<PosResult>;

export class PosApiWeb extends WebPlugin implements PosApiPlugin {
  // system
  beep = unavailableResult;
  powerOn = unavailableResult;
  powerOff = unavailableResult;
  getVersion = unavailableResult;
  getSerial = unavailableResult;
  getChipId = unavailableResult;
  getTime = unavailableResult;
  setTime = unavailableResult as unknown as PosApiPlugin['setTime'];
  setLog = unavailableResult as unknown as PosApiPlugin['setLog'];
  setLed = unavailableResult as unknown as PosApiPlugin['setLed'];
  setEntryMode = unavailableResult as unknown as PosApiPlugin['setEntryMode'];
  async isReady(): Promise<PosReadyResult> { return { ok: true, ready: false, error: 'web' }; }

  // printer
  initializePrinter = unavailableResult;
  printText = unavailableResult as unknown as PosApiPlugin['printText'];
  startPrint = unavailableResult;
  printReceipt = unavailableResult as unknown as PosApiPlugin['printReceipt'];
  async closePrinter() { return { ok: true as const }; }
  printerStatus = unavailableResult;

  // ICC
  openCard = unavailableResult;
  closeCard = unavailableResult;
  checkCard = unavailableResult;
  sendApdu = unavailableResult as unknown as PosApiPlugin['sendApdu'];

  // NFC
  openNfc = unavailableResult;
  closeNfc = unavailableResult;
  detectCard = unavailableResult;
  removeCard = unavailableResult;
  resetCard = unavailableResult;
  entryPoint = unavailableResult;

  // MSR
  openMag = unavailableResult;
  closeMag = unavailableResult;
  resetMag = unavailableResult;
  checkMag = unavailableResult;
  readMagStripe = unavailableResult;

  // Scanner
  openScanner = unavailableResult;
  closeScanner = unavailableResult;
  scan = unavailableResult as unknown as PosApiPlugin['scan'];

  // PIN
  setTimeout = unavailableResult as unknown as PosApiPlugin['setTimeout'];
  setPinType = unavailableResult as unknown as PosApiPlugin['setPinType'];
  enterPin = unavailableResult;
  getPinBlock = unavailableResult as unknown as PosApiPlugin['getPinBlock'];

  // EMV
  initEmv = unavailableResult;
  startTransaction = unavailableResult;
  completeTransaction = unavailableResult as unknown as PosApiPlugin['completeTransaction'];
  getEmvVersion = unavailableResult;
  setAmount = unavailableResult as unknown as PosApiPlugin['setAmount'];
  setTransactionType = unavailableResult as unknown as PosApiPlugin['setTransactionType'];
  setCardType = unavailableResult as unknown as PosApiPlugin['setCardType'];
  setOnlineResult = unavailableResult as unknown as PosApiPlugin['setOnlineResult'];
  prepareField55 = unavailableResult;
  getTag = unavailableResult as unknown as PosApiPlugin['getTag'];
  loadAid = unavailableResult as unknown as PosApiPlugin['loadAid'];
  loadCapk = unavailableResult as unknown as PosApiPlugin['loadCapk'];
  saveTermParas = unavailableResult as unknown as PosApiPlugin['saveTermParas'];
  clearAllAids = unavailableResult;
  clearAllCapks = unavailableResult;

  // Fingerprint
  openFingerprint = unavailableResult;
  closeFingerprint = unavailableResult;
  captureFingerprint = unavailableResult as unknown as PosApiPlugin['captureFingerprint'];
  matchFingerprint = unavailableResult;
  getFingerprintCode = unavailableResult;
  deleteFingerprints = unavailableResult;

  // ID card
  openIdReader = unavailableResult;
  closeIdReader = unavailableResult;
  readId = unavailableResult as unknown as PosApiPlugin['readId'];

  // Serial
  send = unavailableResult as unknown as PosApiPlugin['send'];
  receive = unavailableResult as unknown as PosApiPlugin['receive'];
}
