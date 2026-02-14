/**
 * Hook for managing kernel state and operations using web-python-kernel
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { KernelManager, KernelMode, KernelLanguage, KernelEvents } from 'web-python-kernel';
import { KernelInfo, KernelLogEntry, LogEntryInput, ExecuteCodeCallbacks } from '../utils/agentLabTypes';
import { createKernelResetCode } from '../utils/kernelUtils';
import { showToast } from '../utils/notebookUtils';
import { FileSystemDirectoryHandle } from '../lib/fileSystemUtils';

interface UseKernelManagerProps {
  
  server?: unknown; // Keep for API compatibility but won't be used
  clearRunningState?: () => void;
  onKernelReady?: (executeCode: (code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) => void;
  autoStart?: boolean;
}

// Types for kernel events to replace explicit any
interface KernelStreamData {
  name: 'stdout' | 'stderr';
  text: string;
}

interface KernelMimeBundle {
  'text/plain'?: string;
  'text/html'?: string;
  'image/png'?: string;
  [key: string]: string | undefined;
}

interface KernelResultData {
  data: KernelMimeBundle;
}

interface KernelErrorData {
  ename: string;
  evalue: string;
  traceback: string[];
}

type KernelEvent = 
  | { type: 'stream'; data: KernelStreamData }
  | { type: 'execute_result'; data: KernelResultData }
  | { type: 'display_data'; data: KernelResultData }
  | { type: 'execute_error' | 'error'; data: KernelErrorData };

type LogEntryHandler = (entry: LogEntryInput) => void;
type ProcessBufferHandler = (bufferRef: React.MutableRefObject<string>, type: 'stdout' | 'stderr', callbacks?: ExecuteCodeCallbacks) => void;

// Helper to handle test interception for mounting
const handleTestIntercept = async (
  manager: unknown,
  kernelId: string,
  dirHandle: unknown
): Promise<boolean> => {
  const globalScope = globalThis as unknown as {
    TEST_INTERCEPT_MOUNT: (
      manager: unknown,
      kernelId: string,
      dirHandle: unknown
    ) => Promise<boolean>;
  };

  if (globalScope.TEST_INTERCEPT_MOUNT) {
    console.log("Triggering TEST_INTERCEPT_MOUNT");
    return await globalScope.TEST_INTERCEPT_MOUNT(manager, kernelId, dirHandle);
  }
  
  console.debug("TEST_INTERCEPT_MOUNT not detected, proceeding with real mount");
  return false;
};

// Helper to attempt mounting a folder
const attemptMount = async (
  manager: KernelManager,
  kernelId: string,
  dirHandle: FileSystemDirectoryHandle
): Promise<boolean> => {
  if (await handleTestIntercept(manager, kernelId, dirHandle)) {
    return true;
  }

  const kernel = manager.getKernel(kernelId);
  if (kernel?.kernel?.mountFS) {
    try {
      await kernel.kernel.mountFS('/data', dirHandle, 'readwrite');
      return true;
    } catch (mountError) {
      console.debug('Mount failed (will retry):', mountError);
    }
  }
  return false;
};

// Helper handlers for specific event types
const handleStreamEvent = (
  event: { type: 'stream'; data: KernelStreamData },
  stdoutRef: React.MutableRefObject<string>,
  stderrRef: React.MutableRefObject<string>,
  processBuffer: ProcessBufferHandler,
  callbacks?: ExecuteCodeCallbacks
) => {
  if (event.data.name === 'stdout') {
    stdoutRef.current += event.data.text;
    processBuffer(stdoutRef, 'stdout', callbacks);
  } else if (event.data.name === 'stderr') {
    stderrRef.current += event.data.text;
    processBuffer(stderrRef, 'stderr', callbacks);
  }
};

const handleResultEvent = (
  event: { type: 'execute_result'; data: KernelResultData },
  addLog: LogEntryHandler,
  callbacks?: ExecuteCodeCallbacks
) => {
  const data = event.data?.data;
  if (!data) return;

  const textPlain = data['text/plain'];
  // Don't display None results (standard Jupyter behavior)
  if (textPlain && textPlain !== 'None') {
    const output = { type: 'result' as const, content: textPlain, short_content: textPlain };
    addLog(output);
    callbacks?.onOutput?.(output);
  } else if (!textPlain) {
    // Fallback to JSON stringify if text/plain is missing
    const result = JSON.stringify(data);
    const output = { type: 'result' as const, content: result, short_content: result };
    addLog(output);
    callbacks?.onOutput?.(output);
  }
};

const handleDisplayEvent = (
  event: { type: 'display_data'; data: KernelResultData },
  addLog: LogEntryHandler,
  callbacks?: ExecuteCodeCallbacks
) => {
  const data = event.data?.data;
  if (!data) return;

  if (data['image/png']) {
    const output = {
      type: 'image' as const,
      content: `data:image/png;base64,${data['image/png']}`,
      short_content: '[Image]'
    };
    addLog(output);
    callbacks?.onOutput?.(output);
  } else if (data['text/html']) {
    const output = { type: 'html' as const, content: data['text/html'], short_content: '[HTML]' };
    addLog(output);
    callbacks?.onOutput?.(output);
  } else if (data['text/plain']) {
    const output = { type: 'result' as const, content: data['text/plain'], short_content: data['text/plain'] };
    addLog(output);
    callbacks?.onOutput?.(output);
  }
};

const handleErrorEvent = (
  event: { type: 'execute_error' | 'error'; data: KernelErrorData },
  addLog: LogEntryHandler,
  callbacks?: ExecuteCodeCallbacks
) => {
  const errorMsg = event.data
    ? `${event.data.ename || 'Error'}: ${event.data.evalue || 'Unknown error'}`
    : 'Execution failed';
  
  const errorOutput = { type: 'error' as const, content: errorMsg, short_content: errorMsg };
  addLog(errorOutput);
  callbacks?.onOutput?.(errorOutput);

  if (event.data?.traceback) {
    event.data.traceback.forEach((line) => {
      const tracebackOutput = { type: 'stderr' as const, content: line, short_content: line };
      addLog(tracebackOutput);
      callbacks?.onOutput?.(tracebackOutput);
    });
  }
};

// Main event handler helper
const handleKernelEvent = (
  event: KernelEvent,
  stdoutBufferRef: React.MutableRefObject<string>,
  stderrBufferRef: React.MutableRefObject<string>,
  processBuffer: ProcessBufferHandler,
  addKernelLogEntry: LogEntryHandler,
  callbacks?: ExecuteCodeCallbacks
): boolean => {
  let hasError = false;

  switch (event.type) {
    case 'stream':
      handleStreamEvent(event, stdoutBufferRef, stderrBufferRef, processBuffer, callbacks);
      break;
    case 'execute_result':
      handleResultEvent(event, addKernelLogEntry, callbacks);
      break;
    case 'display_data':
      handleDisplayEvent(event, addKernelLogEntry, callbacks);
      break;
    case 'execute_error':
    case 'error':
      hasError = true;
      handleErrorEvent(event, addKernelLogEntry, callbacks);
      break;
  }

  return hasError;
};

// Helper to flush remaining buffers
const flushBuffers = (
  stdoutBufferRef: React.MutableRefObject<string>,
  stderrBufferRef: React.MutableRefObject<string>,
  addLog: LogEntryHandler,
  callbacks?: ExecuteCodeCallbacks
) => {
  if (stdoutBufferRef.current) {
    const line = stdoutBufferRef.current;
    if (line.length > 0) {
      const output = { type: 'stdout' as const, content: line, short_content: line };
      addLog(output);
      callbacks?.onOutput?.(output);
    }
    stdoutBufferRef.current = '';
  }
  if (stderrBufferRef.current) {
    const line = stderrBufferRef.current;
    if (line.length > 0) {
      const output = { type: 'stderr' as const, content: line, short_content: line };
      addLog(output);
      callbacks?.onOutput?.(output);
    }
    stderrBufferRef.current = '';
  }
};

interface DatasetKernelState {
  kernelId: string;
  executeCode: (code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>;
  isReady: boolean;
  status: 'idle' | 'busy' | 'starting' | 'error';
}

export const useKernelManager = ({ clearRunningState, onKernelReady, autoStart = false }: UseKernelManagerProps) => {
  const [isReady, setIsReady] = useState(false);
  const [kernelStatus, setKernelStatus] = useState<'idle' | 'busy' | 'starting' | 'error'>(autoStart ? 'starting' : 'idle');
  const [executeCode, setExecuteCode] = useState<((code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) | null>(null);
  const [kernelInfo, setKernelInfo] = useState<KernelInfo>({});
  const [kernelExecutionLog, setKernelExecutionLog] = useState<KernelLogEntry[]>([]);
  // const [internalActiveDatasetId, setInternalActiveDatasetId] = useState<string | null>(null);
  const internalActiveDatasetId: string | null = null;
  const setInternalActiveDatasetId: (id: string | null) => void = () => {};
  
  // Add ref to store executeCode function to avoid circular dependencies
  const executeCodeRef = useRef<((code: string, callbacks?: ExecuteCodeCallbacks, timeout?: number) => Promise<void>) | null>(null);
  
  // Add ref to store the web-python-kernel manager and kernel ID
  const kernelManagerRef = useRef<{
    manager: KernelManager;
    KernelMode: typeof KernelMode;
    KernelLanguage: typeof KernelLanguage;
    KernelEvents: typeof KernelEvents;
  } | null>(null);
  const currentKernelIdRef = useRef<string | null>(null);
  
  // Add ref to prevent multiple initializations
  const isInitializingRef = useRef(false);
  // Add ref to store onKernelReady callback to prevent dependency issues
  const onKernelReadyRef = useRef(onKernelReady);
  // Map to track kernel instances per dataset
  const datasetKernelsRef = useRef<Map<string, DatasetKernelState>>(new Map());


  // Buffers for stdout and stderr to handle chunked output
  const stdoutBufferRef = useRef<string>('');
  const stderrBufferRef = useRef<string>('');

  // Update the onKernelReady ref when it changes
  useEffect(() => {
    onKernelReadyRef.current = onKernelReady;
  }, [onKernelReady]);

  // Function to update kernel log
  const addKernelLogEntry = useCallback((entryData: LogEntryInput) => {
    const newEntry: KernelLogEntry = {
      ...entryData,
      type: (typeof entryData.type === 'string') ? entryData.type : 'info',
      timestamp: entryData.timestamp ?? Date.now(),
    };
    setKernelExecutionLog(prevLog => [...prevLog, newEntry]);
  }, []);

  const clearLogs = useCallback(() => {
    setKernelExecutionLog([]);
  }, []);

  // Helper to process buffer and emit lines
  const processBuffer = useCallback((
    bufferRef: React.MutableRefObject<string>, 
    type: 'stdout' | 'stderr', 
    callbacks?: ExecuteCodeCallbacks
  ) => {
    const buffer = bufferRef.current;
    if (!buffer) return;

    // Split by newline
    const lines = buffer.split('\n');
    
    // We will emit all complete lines (those followed by \n).
    // The last element of split is the remainder.
    const remainder = lines.pop() || '';
    
    lines.forEach(line => {
      if (line.length > 0) {
        const output = {
          type,
          content: line,
          short_content: line
        };
        addKernelLogEntry(output);
        if (callbacks?.onOutput) callbacks.onOutput(output);
      }
    });
    
    bufferRef.current = remainder;
  }, [addKernelLogEntry]);

  // Function to dynamically load web-python-kernel module
  const loadWebPythonKernel = useCallback(async () => {
    if (kernelManagerRef.current) {
      return kernelManagerRef.current;
    }

    // Support for E2E testing mock
    const globalWindow = globalThis as unknown as { MOCK_KERNEL_MANAGER: {
      manager: KernelManager;
      KernelMode: typeof KernelMode;
      KernelLanguage: typeof KernelLanguage;
      KernelEvents: typeof KernelEvents;
    }, TEST_INTERCEPT_MOUNT: unknown };
    if (globalWindow.MOCK_KERNEL_MANAGER) {
      console.log('Using Mock Kernel Manager from window.MOCK_KERNEL_MANAGER');
      kernelManagerRef.current = globalWindow.MOCK_KERNEL_MANAGER;
      return kernelManagerRef.current;
    }

    try {
      // Create kernel manager with local worker URL
      const workerUrl = `/kernel.worker.js`;

      const manager = new KernelManager({
        allowedKernelTypes: [
          { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
        ],
        interruptionMode: 'auto',
        workerUrl,
        pool: {
          enabled: false,
          poolSize: 0,
          autoRefill: false
        }
      });

      kernelManagerRef.current = { manager, KernelMode, KernelLanguage, KernelEvents };
      return kernelManagerRef.current;
    } catch (error) {
      console.error('[Web Python Kernel] Failed to load kernel module:', error);
      throw error;
    }
  }, []);

  // Create executeCode function that wraps the kernel execution
  const createExecuteCodeFunction = useCallback((manager: KernelManager, kernelId: string) => {
    return async (code: string, callbacks?: ExecuteCodeCallbacks, _timeout?: number) => {
      let hasError = false;

      try {
        setKernelStatus('busy');

        const stream = manager.executeStream(kernelId, code);

        for await (const event of stream) {
          const eventError = handleKernelEvent(
            event as KernelEvent,
            stdoutBufferRef,
            stderrBufferRef,
            processBuffer,
            addKernelLogEntry,
            callbacks
          );
          if (eventError) {
            hasError = true;
          }
        }

        flushBuffers(stdoutBufferRef, stderrBufferRef, addKernelLogEntry, callbacks);
        setKernelStatus('idle');

        // Signal completion via onStatus callback
        if (callbacks?.onStatus) {
          if (hasError) {
            callbacks.onStatus('Error');
          } else {
            callbacks.onStatus('Completed');
          }
        }

      } catch (error) {
        setKernelStatus('idle');
        console.error('[Web Python Kernel] Execution error:', error);

        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorOutput = {
          type: 'error' as const,
          content: errorMsg,
          short_content: errorMsg
        };
        addKernelLogEntry(errorOutput);
        
        if (callbacks?.onOutput) {
          callbacks.onOutput(errorOutput);
        }

        // Signal error via onStatus callback
        if (callbacks?.onStatus) {
          callbacks.onStatus('Error');
        }
      }
    };
  }, [addKernelLogEntry, processBuffer]);

  // Function to initialize the executeCode function
  const initializeExecuteCode = useCallback((manager: KernelManager, kernelInfo: KernelInfo) => {
    const kernelId = kernelInfo.kernelId || kernelInfo.id;
    if (!kernelId) {
      console.error('[Web Python Kernel] Cannot initialize executeCode: no kernel ID');
      return;
    }

    const executeCodeFn = createExecuteCodeFunction(manager, kernelId);

    setExecuteCode(() => executeCodeFn);
    executeCodeRef.current = executeCodeFn;

    // Call onKernelReady callback
    onKernelReadyRef.current?.(executeCodeFn);
  }, [createExecuteCodeFunction]);

  // Define startKernel (was initializeKernel)
  const startKernel = useCallback(async () => {
    // Prevent multiple concurrent initializations
    if (isInitializingRef.current) {
      return;
    }

    // If already ready, don't reinitialize
    if (currentKernelIdRef.current && kernelManagerRef.current?.manager) {
      return;
    }

    // Mark as initializing
    isInitializingRef.current = true;

    const initTimeout = setTimeout(() => {
      console.error('[Web Python Kernel] Initialization timeout after 180 seconds');
      setKernelStatus('error');
      setIsReady(false);
      showToast('Kernel initialization timed out. Please try restarting.', 'error');
      isInitializingRef.current = false;
    }, 180000); // 180 second timeout

    try {
      setKernelStatus('starting');

      // Load the kernel module
      const { manager, KernelMode, KernelLanguage, KernelEvents } = await loadWebPythonKernel();
      
      // Create a new kernel
      const kernelId = await manager.createKernel({
        mode: KernelMode.WORKER,
        language: KernelLanguage.PYTHON,
        autoSyncFs: true,
      });

      // Store kernel ID
      currentKernelIdRef.current = kernelId;

      // Set up event listeners
      manager.onKernelEvent(kernelId, KernelEvents.KERNEL_BUSY, () => {
        setKernelStatus('busy');
      });

      manager.onKernelEvent(kernelId, KernelEvents.KERNEL_IDLE, () => {
        setKernelStatus('idle');
      });

      // Clear the timeout since we succeeded
      clearTimeout(initTimeout);

      // Update state
      const newKernelInfo = { kernelId, id: kernelId };
      setKernelInfo(newKernelInfo);
      setKernelStatus('idle');
      setIsReady(true);

      // Initialize the executeCode function
      initializeExecuteCode(manager, newKernelInfo);

      // Reset initialization flag
      isInitializingRef.current = false;
    } catch (error) {
      clearTimeout(initTimeout);
      console.error('[Web Python Kernel] Initialization error:', error);
      setKernelStatus('error');
      setIsReady(false);

      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(`Kernel initialization failed: ${errorMessage}`, 'error');

      // Reset initialization flag on error
      isInitializingRef.current = false;
    }
  }, [loadWebPythonKernel, initializeExecuteCode]);

  // Kernel initialization
  useEffect(() => {
    if (autoStart) {
      startKernel();
    }
  }, [autoStart, startKernel]);

  // Function to destroy current kernel
  const destroyCurrentKernel = useCallback(async () => {
    const manager = kernelManagerRef.current?.manager;
    const kernelId = currentKernelIdRef.current;

    if (!manager || !kernelId) return;

    try {
      await manager.destroyKernel(kernelId);
      currentKernelIdRef.current = null;
    } catch (error) {
      console.warn('[Web Python Kernel] Error destroying kernel:', error);
    }
  }, []);

  // Function to interrupt kernel execution
  const interruptKernel = useCallback(async () => {
    const manager = kernelManagerRef.current?.manager;
    const kernelId = currentKernelIdRef.current;

    if (!manager || !kernelId) {
      showToast('No active kernel to interrupt', 'warning');
      return false;
    }

    try {
      showToast('Interrupting kernel execution...', 'loading');
      const success = await manager.interruptKernel(kernelId);

      if (success) {
        showToast('Kernel execution interrupted', 'success');
      } else {
        showToast('Failed to interrupt kernel execution', 'error');
      }

      return success;
    } catch (error) {
      console.error('[Web Python Kernel] Error interrupting kernel:', error);
      showToast('Error interrupting kernel execution', 'error');
      return false;
    }
  }, []);

  
  const restartKernel = useCallback(async (options?: Record<string, unknown>) => {
    let manager = kernelManagerRef.current?.manager;
    let { KernelMode, KernelLanguage, KernelEvents } = kernelManagerRef.current || {};
    
    if (!manager) {
      try {
        const loaded = await loadWebPythonKernel();
        manager = loaded.manager;
        KernelMode = loaded.KernelMode;
        KernelLanguage = loaded.KernelLanguage;
        KernelEvents = loaded.KernelEvents;
      } catch (error) {
        const errorsStr = error instanceof Error ? error.message : String(error);
        showToast(`Failed to load kernel manager. Error: ${errorsStr}`, 'error');
        return;
      }
    }

    const kernelId = currentKernelIdRef.current;

    if (!manager || !KernelMode || !KernelLanguage) {
      showToast('Kernel manager not initialized', 'error');
      return;
    }

    showToast('Restarting kernel...', 'loading');

    try {
      setKernelStatus('starting');

      // Destroy current kernel if it exists
      if (kernelId) {
        try {
          await manager.destroyKernel(kernelId);
        } catch (error) {
          console.warn('[Web Python Kernel] Error destroying old kernel:', error);
        }
      }

      // Create a new kernel
      const newKernelId = await manager.createKernel({
        mode: KernelMode.WORKER,
        language: KernelLanguage.PYTHON,
        autoSyncFs: true,
        ...options
      });

      // Store kernel ID
      currentKernelIdRef.current = newKernelId;

      // Re-setup event listeners
      if (KernelEvents) {
        manager.onKernelEvent(newKernelId, KernelEvents.KERNEL_BUSY, () => {
          setKernelStatus('busy');
        });

        manager.onKernelEvent(newKernelId, KernelEvents.KERNEL_IDLE, () => {
          setKernelStatus('idle');
        });
      }

      // Update state
      const newKernelInfo = { kernelId: newKernelId, id: newKernelId };
      setKernelInfo(newKernelInfo);
      setKernelStatus('idle');
      setIsReady(true);

      // Initialize the executeCode function
      initializeExecuteCode(manager, newKernelInfo);

      // Clear any running cell states after successful restart
      if (clearRunningState) {
        clearRunningState();
      }

      // Clear logs to prevent duplication on restart
      clearLogs();

      showToast('Kernel restarted successfully', 'success');

    } catch (error) {
      console.error('Failed to restart kernel:', error);
      setKernelStatus('error');
      setIsReady(false);
      showToast(`Failed to restart kernel: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }, [initializeExecuteCode, clearRunningState, loadWebPythonKernel, clearLogs]);

  const resetKernelState = useCallback(async () => {
    if (!isReady) {
      // If kernel isn't ready, perform a full restart
      console.warn('Kernel not ready, performing full restart instead of reset.');
      await restartKernel();
      return;
    }

    showToast('Resetting kernel state...', 'loading');
    try {
      setKernelStatus('busy');

      const resetCode = createKernelResetCode();

      // Use our executeCode function from ref to run the reset command
      const currentExecuteCode = executeCodeRef.current;
      if (currentExecuteCode) {
        await currentExecuteCode(resetCode, {
          onOutput: () => {
            // Reset output received
          },
          onStatus: () => {
            // Reset status received
          }
        });
      }

      // Update status
      setKernelStatus('idle');

      showToast('Kernel state reset successfully', 'success');
    } catch (error) {
      console.error('Failed to reset kernel state:', error);
      setKernelStatus('error');
      showToast('Failed to reset kernel state', 'error');
    }
  }, [isReady, restartKernel]);

  // Function to mount a local folder
  const mountFolder = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    // Wait for kernel to be fully initialized with retries
    const maxRetries = 40; // allow up to ~20s
    const retryDelay = 500; // ms - increased delay for more stability
    
    for (let i = 0; i < maxRetries; i++) {
      const manager = kernelManagerRef.current?.manager;
      const kernelId = currentKernelIdRef.current;

      if (manager && kernelId) {
        if (await attemptMount(manager, kernelId, dirHandle)) {
          return;
        }
      }

      // If kernel not ready yet, wait and retry
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    throw new Error('Kernel not initialized after multiple retries');
  }, []);

  // Function to switch active dataset - stores/restores kernel state per dataset
  const setActiveDatasetId = useCallback((datasetId: string | null) => {
    // Logic currently commented out as it relies on unused state setInternalActiveDatasetId
    if (datasetId === null) return; 

    /*
    if (datasetId === internalActiveDatasetId) return;

    // Save current kernel state for the old dataset
    if (internalActiveDatasetId && currentKernelIdRef.current && executeCodeRef.current) {
      datasetKernelsRef.current.set(internalActiveDatasetId, {
        kernelId: currentKernelIdRef.current,
        executeCode: executeCodeRef.current,
        isReady,
        status: kernelStatus
      });
    }

    // Check if we have a saved kernel for the new dataset
    const savedKernel = datasetId ? datasetKernelsRef.current.get(datasetId) : null;
    
    if (savedKernel) {
      // Restore the saved kernel state
      currentKernelIdRef.current = savedKernel.kernelId;
      executeCodeRef.current = savedKernel.executeCode;
      setExecuteCode(() => savedKernel.executeCode);
      setIsReady(savedKernel.isReady);
      setKernelStatus(savedKernel.status);
      setKernelInfo({ kernelId: savedKernel.kernelId, id: savedKernel.kernelId });
    } else {
      const isAdoptingGlobalKernel = !internalActiveDatasetId && currentKernelIdRef.current;
      
      if (isAdoptingGlobalKernel) {
         console.log('[Web Python Kernel] Adopting pre-existing kernel for dataset:', datasetId);
      } else {
        currentKernelIdRef.current = null;
        executeCodeRef.current = null;
        setExecuteCode(null);
        setIsReady(false);
        setKernelStatus('idle');
        setKernelInfo({});
      }
    }

    setInternalActiveDatasetId(datasetId);
    */
  }, [internalActiveDatasetId, isReady, kernelStatus]);

  return {
    isReady,
    kernelStatus,
    kernelInfo,
    executeCode,
    restartKernel,
    resetKernelState,
    initializeExecuteCode,
    addKernelLogEntry,
    kernelExecutionLog,
    interruptKernel,
    destroyCurrentKernel,
    mountFolder,
    startKernel,
    clearLogs,
    activeDatasetId: internalActiveDatasetId,
    setActiveDatasetId
  };
};
