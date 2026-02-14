import { KernelManager } from 'web-python-kernel';

export type KernelManagerType = KernelManager;

export interface KernelInfo {
  kernelId?: string;
  id?: string;
  
  [key: string]: unknown;
}

export interface KernelLogEntry {
  id?: string;
  timestamp: number;
  type: string;
  content?: string;
  short_content?: string;
  
  [key: string]: unknown;
}

export type KernelExecutionLog = KernelLogEntry;

export type LogEntryInput = Omit<KernelLogEntry, 'timestamp'> & { timestamp?: number };

export interface ExecuteCodeCallbacks {
  onOutput?: (output: { type: string; content: string; short_content?: string }) => void;
  onStatus?: (status: string) => void;
}
