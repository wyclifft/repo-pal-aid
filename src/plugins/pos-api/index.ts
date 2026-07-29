// v2.11.27: Capacitor plugin registration for PosApi.
import { registerPlugin } from '@capacitor/core';
import type { PosApiPlugin } from './definitions';

export * from './definitions';

export const PosApi = registerPlugin<PosApiPlugin>('PosApi', {
  web: () => import('./web').then((m) => new m.PosApiWeb()),
});
