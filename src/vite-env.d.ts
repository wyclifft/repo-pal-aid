/// <reference types="vite/client" />

// Fix NodeJS.Timeout namespace for platform-agnostic timer types
declare namespace NodeJS {
  interface Timeout {}
}

// Module declarations for packages without bundled types
declare module '@capacitor/device' {
  export const Device: {
    getId(): Promise<{ identifier: string }>;
    getInfo(): Promise<{ model: string; operatingSystem: string; osVersion: string; manufacturer: string; name: string; platform: string }>;
  };
}

declare module '@vitejs/plugin-legacy' {
  import { Plugin } from 'vite';
  export default function legacy(options?: Record<string, any>): Plugin[];
}
