// Type declarations for web-python-kernel
// These are inferred based on usage in the project

declare module 'web-python-kernel' {
  export enum KernelMode {
    WORKER = 'worker',
    IFRAME = 'iframe',
  }

  export enum KernelLanguage {
    PYTHON = 'python',
    JAVASCRIPT = 'javascript',
  }

  export enum KernelEvents {
    KERNEL_BUSY = 'kernel_busy',
    KERNEL_IDLE = 'kernel_idle',
  }

  export interface KernelConfig {
    mode: KernelMode;
    language: KernelLanguage;
    autoSyncFs?: boolean;
    [key: string]: unknown;
  }

  export interface KernelManagerConfig {
    allowedKernelTypes: Array<{ mode: KernelMode; language: KernelLanguage }>;
    interruptionMode: string;
    workerUrl: string;
    pool: {
      enabled: boolean;
      poolSize: number;
      autoRefill: boolean;
    };
  }

  export class KernelManager {
    constructor(config: KernelManagerConfig);
    getKernel(kernelId: string): any;
    executeStream(kernelId: string, code: string): AsyncIterable<any>;
    onKernelEvent(kernelId: string, event: KernelEvents, callback: () => void): void;
    createKernel(config: KernelConfig): Promise<string>;
    destroyKernel(kernelId: string): Promise<void>;
    interruptKernel(kernelId: string): Promise<boolean>;
  }
}
