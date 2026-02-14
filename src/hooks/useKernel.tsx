/**
 * Context provider for kernel functionality
 */
import React, { createContext, useContext, ReactNode, useState, useCallback, useRef } from 'react';
import { useKernelManager } from './useKernelManager';
import { KernelInfo, KernelLogEntry, ExecuteCodeCallbacks } from '../utils/agentLabTypes';
import { FileSystemDirectoryHandle } from '../lib/fileSystemUtils';

interface KernelContextType {
  isReady: boolean;
  kernelStatus: 'idle' | 'busy' | 'starting' | 'error';
  kernelInfo: KernelInfo;
  executeCode: ((code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) | null;
  restartKernel: () => Promise<void>;
  resetKernelState: () => Promise<void>;
  kernelExecutionLog: KernelLogEntry[];
  interruptKernel: () => Promise<boolean>;
  mountFolder: (dirHandle: FileSystemDirectoryHandle) => Promise<void>;
  startKernel: () => Promise<void>;
  clearLogs: () => void;
  registerKernelReadyCallback: (callback: (executeCode: (code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) => void) => () => void;
  activeDatasetId: string | null;
  setActiveDatasetId: (id: string | null) => void;
}

const KernelContext = createContext<KernelContextType | undefined>(undefined);

interface KernelProviderProps {
  children: ReactNode;
  clearRunningState?: () => void;
  autoStart?: boolean;
}

export const KernelProvider: React.FC<KernelProviderProps> = ({ 
  children, 
  clearRunningState,
  autoStart = false
}) => {
  // We need to manage multiple listeners for kernel ready
  const kernelReadyCallbacksRef = useRef<Set<(executeCode: (code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) => void>>(new Set());

  const onKernelReady = useCallback((executeCode: (code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) => {
    kernelReadyCallbacksRef.current.forEach(callback => {
      try {
        callback(executeCode);
      } catch (e) {
        console.error("Error in kernel ready callback", e);
      }
    });
  }, []);

  const kernelManager = useKernelManager({
    clearRunningState,
    onKernelReady,
    autoStart
  });

  const registerKernelReadyCallback = useCallback((callback: (executeCode: (code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) => void) => {
    kernelReadyCallbacksRef.current.add(callback);
    
    // If kernel is already ready, call immediately
    if (kernelManager.executeCode) {
      callback(kernelManager.executeCode);
    }
    
    return () => {
      kernelReadyCallbacksRef.current.delete(callback);
    };
  }, [kernelManager.executeCode]);

  const value: KernelContextType = {
    ...kernelManager,
    registerKernelReadyCallback
  };

  return (
    <KernelContext.Provider value={value}>
      {children}
    </KernelContext.Provider>
  );
};

export const useKernel = () => {
  const context = useContext(KernelContext);
  if (context === undefined) {
    throw new Error('useKernel must be used within a KernelProvider');
  }
  return context;
};
