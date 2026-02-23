import React, { useState, useEffect, useRef, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { FiSend, FiCpu, FiTrash2, FiStopCircle, FiZap, FiTerminal, FiEdit2, FiX, FiPlus, FiMessageSquare, FiChevronDown, FiUser, FiShare2, FiCopy, FiCheck, FiMenu } from 'react-icons/fi';
import { useHyphaStore } from '../store/hyphaStore';
import LoginButton from '../components/LoginButton';
import { useKernel } from '../hooks/useKernel';
import { useNavigate, useParams } from 'react-router-dom';
import * as HeadlessUI from '@headlessui/react';

const { MenuButton, MenuItems, MenuItem, Menu, Transition, DialogPanel, TransitionChild, DialogTitle, Dialog } = HeadlessUI;


interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  progressTrace?: {
    summary: string | null;
    details: string[];
  };
}

interface SessionInputDraftCache {
  [sessionKey: string]: string;
}

const MAX_COLLAPSED_MESSAGE_CHARS = 1200;
const MAX_COLLAPSED_MESSAGE_LINES = 16;
const MAX_PROGRESS_TRACE_DETAILS = 30;
const INPUT_DRAFT_CACHE_KEY = 'ri-scale-agent-input-drafts-v1';
const GPT5_NANO_CHAT_MODEL = 'gpt-5-nano';
const GPT5_MINI_CHAT_MODEL = 'gpt-5-mini';
const GPT5_CHAT_MODEL = 'gpt-5';
const GPT52_CHAT_MODEL = 'gpt-5.2';
const GPT41_NANO_CHAT_MODEL = 'gpt-4.1-nano';
const GPT41_MINI_CHAT_MODEL = 'gpt-4.1-mini';
const GPT41_CHAT_MODEL = 'gpt-4.1';
const O4_MINI_CHAT_MODEL = 'o4-mini';
const O3_MINI_CHAT_MODEL = 'o3-mini';
const O3_CHAT_MODEL = 'o3';
const GPT4O_MINI_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_CHAT_MODEL = GPT5_MINI_CHAT_MODEL;

const CHAT_MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: GPT5_NANO_CHAT_MODEL, label: 'GPT-5 nano' },
  { value: GPT5_MINI_CHAT_MODEL, label: 'GPT-5 mini' },
  { value: GPT5_CHAT_MODEL, label: 'GPT-5' },
  { value: GPT52_CHAT_MODEL, label: 'GPT-5.2' },
  { value: GPT41_NANO_CHAT_MODEL, label: 'GPT-4.1 nano' },
  { value: GPT41_MINI_CHAT_MODEL, label: 'GPT-4.1 mini' },
  { value: GPT41_CHAT_MODEL, label: 'GPT-4.1' },
  { value: O4_MINI_CHAT_MODEL, label: 'o4-mini' },
  { value: O3_MINI_CHAT_MODEL, label: 'o3-mini' },
  { value: O3_CHAT_MODEL, label: 'o3' },
  { value: GPT4O_MINI_CHAT_MODEL, label: 'GPT-4o mini' },
];

const CHAT_MODEL_IDS = new Set(CHAT_MODEL_OPTIONS.map(option => option.value));
const DEFAULT_DEV_CHAT_PROXY_APP_ID = 'chat-proxy-dev';
const PRODUCTION_CHAT_PROXY_APP_ID = 'chat-proxy';
const MAX_CHAT_PROXY_APP_ID_LENGTH = 63;
const CHAT_PROXY_REQUEST_TIMEOUT_MS = 300_000;
const CHAT_PROXY_RESOLVE_TIMEOUT_MS = 15_000;
const CHAT_PROXY_COMPLETION_TIMEOUT_MS = 300_000;
const AGENT_TOOL_EXECUTION_LIMIT = 50;
const AGENT_ITERATION_SOFT_TIMEOUT_MS = 90_000;

const slugifyBranchName = (branchName: string): string => {
  const normalized = branchName
    .trim()
    .toLowerCase()
    .replaceAll('_', '-')
    .replaceAll('/', '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'branch';
};

const makeDevAppId = (branchName: string, prefix: string = DEFAULT_DEV_CHAT_PROXY_APP_ID): string => {
  const branchSlug = slugifyBranchName(branchName);
  const suffixBudget = MAX_CHAT_PROXY_APP_ID_LENGTH - prefix.length - 1;
  if (suffixBudget <= 0) {
    return prefix.slice(0, MAX_CHAT_PROXY_APP_ID_LENGTH);
  }
  const trimmedSlug = branchSlug.slice(0, suffixBudget);
  return trimmedSlug ? `${prefix}-${trimmedSlug}` : prefix;
};

const normalizeBranchRefName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const knownPrefixes = ['refs/heads/', 'origin/', 'refs/remotes/origin/'];
  for (const prefix of knownPrefixes) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return trimmed;
};

const uniqueNonEmptyValues = (values: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = (value || '').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
};

const getChatProxyServiceIds = (): string[] => {
  const isProductionBuild = process.env.NODE_ENV === 'production';
  const configuredAppId = (process.env.REACT_APP_CHAT_PROXY_APP_ID || '').trim();
  if (isProductionBuild) {
    return [`ri-scale/default@${PRODUCTION_CHAT_PROXY_APP_ID}`];
  }

  const explicitBranchProxyAppId = (process.env.REACT_APP_CHAT_PROXY_BRANCH_APP_ID || '').trim();

  const branchNameCandidates = uniqueNonEmptyValues([
    process.env.REACT_APP_CHAT_PROXY_BRANCH,
    process.env.REACT_APP_BRANCH_NAME,
    process.env.REACT_APP_GITHUB_HEAD_REF,
    process.env.REACT_APP_GITHUB_REF_NAME,
    process.env.REACT_APP_VERCEL_GIT_COMMIT_REF,
    process.env.REACT_APP_CI_COMMIT_REF_NAME,
    process.env.REACT_APP_BRANCH,
    process.env.GITHUB_HEAD_REF,
    process.env.GITHUB_REF_NAME,
  ]).map(normalizeBranchRefName);

  const branchAppIds = branchNameCandidates.map((branchName) => makeDevAppId(branchName));
  const appIdCandidates = uniqueNonEmptyValues([
    explicitBranchProxyAppId,
    configuredAppId,
    ...branchAppIds,
    DEFAULT_DEV_CHAT_PROXY_APP_ID,
  ]);

  return appIdCandidates.map((appId) => `ri-scale/default@${appId}`);
};

const CHAT_PROXY_SERVICE_IDS = getChatProxyServiceIds();
const CHAT_PROXY_SERVICE_ID = CHAT_PROXY_SERVICE_IDS[0] || `ri-scale/default@${DEFAULT_DEV_CHAT_PROXY_APP_ID}`;

const normalizeRequestedChatModel = (candidate: unknown): string | null => {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  if (!value) return null;
  if (CHAT_MODEL_IDS.has(value)) return value;
  if (value.startsWith('gpt-5.2')) return GPT52_CHAT_MODEL;
  if (value.startsWith('gpt-5-mini')) return GPT5_MINI_CHAT_MODEL;
  if (value.startsWith('gpt-5-nano')) return GPT5_NANO_CHAT_MODEL;
  if (value.startsWith('gpt-5')) return GPT5_CHAT_MODEL;
  if (value.startsWith('gpt-4.1-mini')) return GPT41_MINI_CHAT_MODEL;
  if (value.startsWith('gpt-4.1-nano')) return GPT41_NANO_CHAT_MODEL;
  if (value.startsWith('gpt-4.1')) return GPT41_CHAT_MODEL;
  if (value.startsWith('o4-mini')) return O4_MINI_CHAT_MODEL;
  if (value.startsWith('o3-mini')) return O3_MINI_CHAT_MODEL;
  if (value.startsWith('o3')) return O3_CHAT_MODEL;
  if (value.startsWith('gpt-4o-mini')) return GPT4O_MINI_CHAT_MODEL;
  return null;
};

const resolveAgentChatModel = (manifest: Record<string, any>): string => {
  const configuredModel = normalizeRequestedChatModel(process.env.REACT_APP_CHAT_MODEL);
  if (configuredModel) return configuredModel;

  const manifestModel = normalizeRequestedChatModel(manifest?.model_config?.model)
    || normalizeRequestedChatModel(manifest?.model)
    || normalizeRequestedChatModel(manifest?.chat_model);

  return manifestModel || DEFAULT_CHAT_MODEL;
};

interface Agent {
  id: string; // Artifact ID
  name: string;
  description: string;
  icon?: string;
  status: 'online' | 'offline';
  service_id?: string; // If available
}

interface Session {
  id: string; // Artifact ID
  title: string;
  agentId: string;
  lastModified: number;
}

const CodeBlock = ({ node, inline, className, children, ...props }: any) => {
  const match = /language-(\w+)/.exec(className || '');
  return !inline && match ? (
    <SyntaxHighlighter
      style={oneLight}
      language={match[1]}
      PreTag="div"
      {...props}
    >
      {String(children).replace(/\n$/, '')}
    </SyntaxHighlighter>
  ) : (
    <code className={className} {...props}>
      {children}
    </code>
  );
};

const toBase64Utf8 = (value: string): string => {
  return globalThis.btoa(unescape(encodeURIComponent(value)));
};

const AgentPage: React.FC = () => {
  const { server, isConnected, connect, isConnecting, isLoggedIn, login } = useHyphaStore();
  const { workspace, session, '*': extraPath } = useParams<{ workspace?: string; session?: string; '*': string }>();
  const navigate = useNavigate();

  const toRouteSessionId = (artifactId: string, ws: string) => {
    const prefix = `${ws}/`;
    if (artifactId.startsWith(prefix)) {
      return artifactId.slice(prefix.length);
    }
    return artifactId;
  };

  const sessionFromRoute = session
    ? (extraPath ? `${session}/${extraPath}` : session)
    : undefined;

  const { 
    isReady: isKernelReady, 
    startKernel, 
    executeCode, 
    kernelStatus, 
    kernelExecutionLog,
    interruptKernel,
    // activeDatasetId, 
    // setActiveDatasetId 
  } = useKernel();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [agentProgress, setAgentProgress] = useState<string | null>(null);
  const [agentProgressDetails, setAgentProgressDetails] = useState<string[]>([]);
  const [showAgentProgressDetails, setShowAgentProgressDetails] = useState(false);
  const [typingSessionKey, setTypingSessionKey] = useState<string | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({});
  const [expandedProgressMessageIds, setExpandedProgressMessageIds] = useState<Record<string, boolean>>({});
  
  // Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Session State
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionCollectionId, setSessionCollectionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  
  // Share State
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<string | null>>(Promise.resolve(null));
  const agentProgressRef = useRef<string | null>(null);
  const agentProgressDetailsRef = useRef<string[]>([]);
  const [agentSystemPrompt, setAgentSystemPrompt] = useState<string | null>(null);
  const [agentWelcomeMessage, setAgentWelcomeMessage] = useState<string | null>(null);
  const [isWelcomeMessageLoading, setIsWelcomeMessageLoading] = useState(false);
  const [hasAttemptedWelcomeMessageLoad, setHasAttemptedWelcomeMessageLoad] = useState(false);
  const [agentChatModel, setAgentChatModel] = useState<string>(DEFAULT_CHAT_MODEL);
  const activeChatProxyServiceIdRef = useRef<string>(CHAT_PROXY_SERVICE_ID);
  const agentLoadInFlightKeyRef = useRef<string | null>(null);
  const agentLoadCompletedKeyRef = useRef<string | null>(null);

  const defaultAgentId = 'hypha-agents/grammatical-deduction-bury-enormously';
    const LOCAL_DRAFT_SESSION_ID = '__local_draft_session__';
    const ANONYMOUS_SESSION_KEY = '__anonymous_chat__';
    const DEFAULT_CHAT_TITLE = 'New Chat';

    const getSessionKey = (sessionId: string | null) => {
      if (sessionId) return sessionId;
      return isLoggedIn ? LOCAL_DRAFT_SESSION_ID : ANONYMOUS_SESSION_KEY;
    };

    const readInputDraftCache = (): SessionInputDraftCache => {
      try {
        const raw = globalThis.localStorage.getItem(INPUT_DRAFT_CACHE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as SessionInputDraftCache;
        }
      } catch {
      }
      return {};
    };

    const writeInputDraftCache = (cache: SessionInputDraftCache) => {
      try {
        globalThis.localStorage.setItem(INPUT_DRAFT_CACHE_KEY, JSON.stringify(cache));
      } catch {
      }
    };

    const persistInputDraft = (sessionKey: string, draftText: string) => {
      const cache = readInputDraftCache();
      if (!draftText.trim()) {
        if (sessionKey in cache) {
          delete cache[sessionKey];
          writeInputDraftCache(cache);
        }
        return;
      }
      cache[sessionKey] = draftText;
      writeInputDraftCache(cache);
    };

    const getInputDraft = (sessionKey: string) => {
      const cache = readInputDraftCache();
      return cache[sessionKey] || '';
    };

    const currentSessionKeyRef = useRef<string>(getSessionKey(currentSessionId));

    const getWelcomeMessages = () => {
      if (isWelcomeMessageLoading) {
        return [];
      }
      const hasAgentWelcome = Boolean(agentWelcomeMessage && agentWelcomeMessage.trim());
      if (!hasAgentWelcome && !hasAttemptedWelcomeMessageLoad) {
        return [];
      }
      const welcomeText = hasAgentWelcome
        ? agentWelcomeMessage!
        : `Hello! I'm ${selectedAgent?.name || 'your assistant'}, how may I help you today?`;
      return [{
        id: `welcome-${Date.now()}`,
        role: 'assistant' as const,
        content: welcomeText,
        timestamp: new Date()
      }];
    };

    const createLocalDraftSession = (): Session => ({
      id: LOCAL_DRAFT_SESSION_ID,
      title: DEFAULT_CHAT_TITLE,
      agentId: selectedAgent?.id || defaultAgentId,
      lastModified: Date.now()
    });

    const ensureLocalDraftSession = () => {
      setSessions(prev => {
        const withoutDraft = prev.filter(s => s.id !== LOCAL_DRAFT_SESSION_ID);
        return [createLocalDraftSession(), ...withoutDraft];
      });
      setCurrentSessionId(LOCAL_DRAFT_SESSION_ID);
    };

    useEffect(() => {
      currentSessionKeyRef.current = getSessionKey(currentSessionId);
    }, [currentSessionId, isLoggedIn]);

    useEffect(() => {
      const sessionKey = getSessionKey(currentSessionId);
      const savedDraft = getInputDraft(sessionKey);
      setInput(savedDraft);
    }, [currentSessionId, isLoggedIn]);

    useEffect(() => {
      const sessionKey = getSessionKey(currentSessionId);
      persistInputDraft(sessionKey, input);
    }, [input, currentSessionId, isLoggedIn]);

  // Helper to ensure session collection exists
  const ensureSessionCollection = async () => {
    if (!server || !isLoggedIn) return null;
    try {
      const am = await server.getService('public/artifact-manager');
      const collectionAlias = 'ri-scale-model-hub-sessions';
      const myWorkspace = server.config.workspace;
      const fullId = `${myWorkspace}/${collectionAlias}`;

      try {
        const existing = await am.read({
          artifact_id: fullId,
          _rkwargs: true
        });
        setSessionCollectionId(existing.id);
        return existing.id;
      } catch {
        console.log("Creating session collection...");
        const created = await am.create({
          artifact_id: fullId,
          type: "collection",
          manifest: {
            name: "Agent Chat Sessions",
            description: "Collection of chat sessions for RI-SCALE Model Hub",
          },
          _rkwargs: true
        });
        setSessionCollectionId(created.id);
        return created.id;
      }
    } catch (e) {
      console.error("Error ensuring session collection:", e);
      return null;
    }
  };

  // Helper to save current session
  const saveSession = async (sessionId: string | null, msgs: Message[], agId: string, title?: string) => {
    const doSave = async () => {
      if (!server || !isLoggedIn) return null;
      
      // Check if we are "forking" a shared session
      // If sessionId is provided, check if it belongs to another workspace
      if (sessionId && sessionId.includes('/') && !sessionId.startsWith(server.config.workspace + '/')) {
          sessionId = null; // Reset to null to trigger creation
      }

      if (!sessionCollectionId && !sessionId) {
          // Try ensuring collection one last time
          const colId = await ensureSessionCollection();
          if (!colId) return null;
      }
      
      const am = await server.getService('public/artifact-manager');

      let sessionTitle = title || DEFAULT_CHAT_TITLE;
      const manifest = {
        name: sessionTitle,
        description: `Chat session with agent ${agId}`,
        agent_id: agId,
        timestamp: Date.now()
      };
      
      try {
          let artifactId = sessionId;
          let createdNow = false;
          
          if (!artifactId) {
              // Create new artifact
              const created = await am.create({
                  type: "generic",
                  alias: "{uuid}",
                  manifest: manifest,
                  config: {
                    permissions: {
                      "*": "n",
                      "@": "n"
                    },

                  },
                  parent_id: sessionCollectionId!,
                  stage: true,
                  _rkwargs: true
              });
                artifactId = created.id;
                createdNow = true;
              
              // Add to local list immediately
              const newSession: Session = {
                id: artifactId!,
                title: sessionTitle,
                agentId: agId,
                lastModified: manifest.timestamp
              };
              setSessions(prev => [
                newSession,
                ...prev.filter(s => s.id !== artifactId && s.id !== LOCAL_DRAFT_SESSION_ID)
              ]);
              
          }

          if (!artifactId) return null;

          if (!createdNow && !title) {
            try {
              const existingArtifact = await am.read({
                artifact_id: artifactId,
                _rkwargs: true
              });
              if (existingArtifact?.manifest?.name) {
                sessionTitle = existingArtifact.manifest.name;
                manifest.name = sessionTitle;
              }
            } catch {
            }

            setSessions(prev => prev.map(s => {
              if (s.id === artifactId) {
                return {
                  ...s,
                  title: sessionTitle,
                  lastModified: manifest.timestamp,
                  agentId: agId
                };
              }
              return s;
            }));
          }

          await am.edit({
              artifact_id: artifactId,
              manifest,
              stage: true,
              _rkwargs: true
          });

          const messagesJson = JSON.stringify(msgs);
          const file = new Blob([messagesJson], { type: 'application/json' });
          // We need to use put_file from artifact manager which returns a URL, then PUT to it
          let putUrl: string;
          try {
            putUrl = await am.put_file({
              artifact_id: artifactId,
              file_path: "messages.json",
              _rkwargs: true
            });
          } catch (putError: any) {
            const message = String(putError?.message || putError || '');
            if (!message.includes('Artifact must be in staging mode')) {
              throw putError;
            }

            await am.edit({
              artifact_id: artifactId,
              manifest,
              stage: true,
              _rkwargs: true
            });

            putUrl = await am.put_file({
              artifact_id: artifactId,
              file_path: "messages.json",
              _rkwargs: true
            });
          }
          
          await fetch(putUrl, {
              method: 'PUT',
              body: file,
              headers: { "Content-Type": "application/json" }
          });

          try {
            await am.commit({
              artifact_id: artifactId,
              _rkwargs: true
            });
          } catch (commitError: any) {
            const message = String(commitError?.message || commitError || '');
            if (!message.includes('Artifact must be in staging mode')) {
              throw commitError;
            }

            await am.edit({
              artifact_id: artifactId,
              manifest,
              stage: true,
              _rkwargs: true
            });

            const retryPutUrl = await am.put_file({
              artifact_id: artifactId,
              file_path: "messages.json",
              _rkwargs: true
            });

            await fetch(retryPutUrl, {
              method: 'PUT',
              body: file,
              headers: { "Content-Type": "application/json" }
            });

            await am.commit({
              artifact_id: artifactId,
              _rkwargs: true
            });
          }

          if (createdNow) {
            setCurrentSessionId(artifactId);
            const ws = server.config.workspace;
            const routeSessionId = toRouteSessionId(artifactId, ws);
            navigate(`/agents/${ws}/${routeSessionId}`, { replace: true });
          }
          
          return artifactId;
      } catch (e) {
          console.error("Error saving session:", e);
          return null;
      }
        };

        const queued = saveQueueRef.current.then(doSave, doSave);
        saveQueueRef.current = queued.catch(() => null);
        return queued;
  };

  // Helper to load session
  const fetchSessionData = async (sessionId: string, workspace: string) => {
      if (!server) return;
      try {
          const am = await server.getService('public/artifact-manager');
          // Construct full ID if necessary
          const fullId = sessionId.includes('/') ? sessionId : `${workspace}/${sessionId}`;
          
          let artifact;
          try {
              artifact = await am.read({
                artifact_id: fullId,
                _rkwargs: true
              });
          } catch (e) {
              console.warn("Session not found or accessible:", fullId);
              // Fallback to new chat if not found
              if (isLoggedIn) {
                ensureLocalDraftSession();
                navigate('/agents', { replace: true });
              } else {
                setCurrentSessionId(null);
              }
              setMessages(getWelcomeMessages());
              return;
          }
          
          const agentId = artifact.manifest.agent_id || defaultAgentId;
          
          // Try to find in existing list
          let targetAgent = agents.find(a => a.id === agentId) || agents.find(a => a.id.includes(agentId));
          
          if (!targetAgent) {
              // try to fetch the agent artifact directly
              try {
                  const agentArtifact = await am.read({
                    artifact_id: agentId,
                    _rkwargs: true
                  });

                  targetAgent = {
                      id: agentArtifact.id,
                      name: agentArtifact.manifest?.name || agentArtifact.alias || 'Unnamed Agent',
                      description: agentArtifact.manifest?.description || 'No description provided.',
                      icon: agentArtifact.manifest?.icon,
                      status: 'online', 
                      service_id: agentArtifact.alias ? `hypha-agents/${agentArtifact.alias}` : undefined
                  };
                  // Update agents list with this new found agent? Maybe not necessary, just select it.
                  setAgents(prev => [...prev, targetAgent!]);
              } catch (e) {
                  console.warn("Could not fetch agent details:", agentId);
              }
          }

          if (targetAgent) {
              setSelectedAgent(targetAgent);
          }
          
          // Load messages
          try {
              const fileUrl = await am.get_file({
                artifact_id: fullId,
                file_path: "messages.json",
                _rkwargs: true
              });
              const res = await fetch(fileUrl);
              const loadedMessages = await res.json();
              // Fix dates
              const processedMessages = loadedMessages.map((m: any) => ({
                  ...m,
                  timestamp: new Date(m.timestamp)
              }));
              setMessages(processedMessages);
          } catch (e) {
              try {
                const stagedFileUrl = await am.get_file({
                  artifact_id: fullId,
                  file_path: "messages.json",
                  version: "stage",
                  _rkwargs: true
                });
                const stagedRes = await fetch(stagedFileUrl);
                const stagedMessages = await stagedRes.json();
                const processedStagedMessages = stagedMessages.map((m: any) => ({
                    ...m,
                    timestamp: new Date(m.timestamp)
                }));
                setMessages(processedStagedMessages);
              } catch {
                console.warn("No messages found for session", fullId);
                setMessages([]);
              }
          }
          
          // Set current session ID only if we are the owner, otherwise we are in "clone" mode (new chat on next message)
          // Actually, if we are viewing a shared session, we probably want to keep the ID so we know what we are viewing.
          // The instruction says "if you change to a different chat, wether you own it or not, update those accorfdingly"
          // This implies we should stay on the URL.
          // If we send a message, THEN we might need to fork if we don't have write access.
          
          setCurrentSessionId(fullId);
          if (isLoggedIn) {
            setSessions(prev => {
              const hasDraft = prev.some(s => s.id === LOCAL_DRAFT_SESSION_ID);
              if (hasDraft) return prev;
              return [createLocalDraftSession(), ...prev];
            });
          }

      } catch (e) {
          console.error("Error loading session:", e);
          // If error (e.g. 404), treat as new chat
          if (isLoggedIn) {
            ensureLocalDraftSession();
          } else {
            setCurrentSessionId(null);
          }
          setMessages(getWelcomeMessages());
      }
  };

  const loadSession = (sessionId: string) => {
      if (!server) return;
      if (sessionId === LOCAL_DRAFT_SESSION_ID) {
        navigate('/agents');
        setCurrentSessionId(LOCAL_DRAFT_SESSION_ID);
        setMessages([]);
        return;
      }
      const ws = server.config.workspace;
      const routeSessionId = toRouteSessionId(sessionId, ws);
      navigate(`/agents/${ws}/${routeSessionId}`);
  };

  const deleteSession = async (sessionId: string) => {
      if (!server || !globalThis.confirm("Are you sure you want to delete this chat session?")) return;
      
      try {
          const am = await server.getService('public/artifact-manager');
            if (sessionId === LOCAL_DRAFT_SESSION_ID) {
              setSessions(prev => prev.filter(s => s.id !== LOCAL_DRAFT_SESSION_ID));
              handleNewChat();
              return;
            }
            await am.delete({
              artifact_id: sessionId,
              _rkwargs: true
            });
          setSessions(prev => prev.filter(s => s.id !== sessionId));
          if (currentSessionId === sessionId) {
              handleNewChat();
          }
      } catch (e) {
          console.error("Error deleting session:", e);
      }
  };
  
  const handleNewChat = () => {
      setMessages([]);
      ensureLocalDraftSession();
      navigate('/agents');
  };

  const handleShareSession = async () => {
    if (!currentSessionId || !server) return;
    
    try {
        const am = await server.getService('public/artifact-manager');
        // Update visibility to public
        await am.edit({
          artifact_id: currentSessionId,
          config: {
            permissions: {
              "*": "r",
              "@": "r+"
            },
          },
          _rkwargs: true
        });
        
        const workspace = server.config.workspace;
        // Use the new route format
        const routeSessionId = toRouteSessionId(currentSessionId, workspace);
        const url = `${globalThis.location.origin}/#/agents/${workspace}/${routeSessionId}`;
        setShareUrl(url);
        setIsShareModalOpen(true);
        setHasCopied(false);
    } catch (e: any) {
        console.error("Error sharing session:", e);
        alert("Failed to share session. Ensure you have permission or the server is reachable.");
    }
  };

  const copyToClipboard = () => {
      if (shareUrl) {
          navigator.clipboard.writeText(shareUrl);
          setHasCopied(true);
          setTimeout(() => setHasCopied(false), 2000);
      }
  };

  const copyTextWithFeedback = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey(prev => (prev === key ? null : prev));
      }, 1500);
    } catch (copyError) {
      console.error('Failed to copy text:', copyError);
    }
  };

  const downloadTextReport = (text: string, prefix: string) => {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${prefix}-${stamp}.log`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      console.error('Failed to download report:', downloadError);
    }
  };

  // Initialize kernel if not ready
  useEffect(() => {
    if (!isKernelReady && kernelStatus === 'idle') {
      startKernel();
    }
  }, [isKernelReady, kernelStatus, startKernel]);

  useEffect(() => {
    if (!isKernelReady) {
      agentLoadInFlightKeyRef.current = null;
      agentLoadCompletedKeyRef.current = null;
    }
  }, [isKernelReady]);

  // Fetch agents and sessions
  useEffect(() => {
      const init = async () => {
           if (!server) return;
           
           setLoadingAgents(true);
           setLoadingSessions(true);
           
           try {
               const am = await server.getService('public/artifact-manager');
               
               // 1. Fetch Agents
                 const initialAgents = await am.list({
                   parent_id: 'hypha-agents/agents',
                   limit: 100,
                   _rkwargs: true
                 });
               
               const mappedAgents: Agent[] = initialAgents.map((art: any) => ({
                   id: art.id,
                   name: art.manifest?.name || art.alias || 'Unnamed Agent',
                   description: art.manifest?.description || 'No description provided.',
                   icon: art.manifest?.icon,
                   status: 'online', 
                   service_id: art.alias ? `hypha-agents/${art.alias}` : undefined
               }));
               
               setAgents(mappedAgents);
               setLoadingAgents(false);
               
               // Set default agent if none selected
               if (!selectedAgent && mappedAgents.length > 0 && !session) {
                   const def = mappedAgents.find(a => a.id === defaultAgentId || a.id.includes('grammatical-deduction'));
                   setSelectedAgent(def || mappedAgents[0]);
               }

               // 2. Fetch Sessions
               const colId = await ensureSessionCollection();
               if (colId) {
                     const sessionsList = await am.list({
                       parent_id: colId,
                       _rkwargs: true
                     });
                   const localSessions: Session[] = sessionsList.map((s: any) => ({
                       id: s.id,
                       title: s.manifest?.name || DEFAULT_CHAT_TITLE,
                       agentId: s.manifest?.agent_id || defaultAgentId,
                       lastModified: s.manifest?.timestamp || 0
                   })).sort((a: any, b: any) => b.lastModified - a.lastModified);
                   
                  if (isLoggedIn) {
                    setSessions([createLocalDraftSession(), ...localSessions]);
                    if (!sessionFromRoute) {
                      setCurrentSessionId(LOCAL_DRAFT_SESSION_ID);
                    }
                  } else {
                    setSessions(localSessions);
                  }
               }
               setLoadingSessions(false);
               
           } catch (e: any) {
               console.error("Error initializing AgentPage:", e);
               setAgentError(e.message);
               setLoadingAgents(false);
               setLoadingSessions(false);
           }
      };
      
      if (isConnected && server) {
          init();
      }
  }, [server, isConnected, isLoggedIn, sessionFromRoute]); 

  // Load session from URL
    useEffect(() => {
      if (workspace && sessionFromRoute && server) {
        console.log("Loading session from URL:", workspace, sessionFromRoute);
        fetchSessionData(sessionFromRoute, workspace);

        // Normalize malformed URLs like /agents/ws/ws/uuid -> /agents/ws/uuid
        if (extraPath) {
          const routeSessionId = toRouteSessionId(sessionFromRoute, workspace);
          navigate(`/agents/${workspace}/${routeSessionId}`, { replace: true });
        }
      } else if (!sessionFromRoute && server) {
          // New chat mode
          if (isLoggedIn) {
            ensureLocalDraftSession();
          } else {
            setCurrentSessionId(null);
          }
          setMessages(getWelcomeMessages());
      }
    }, [workspace, sessionFromRoute, extraPath, server, navigate, isLoggedIn, agentWelcomeMessage, isWelcomeMessageLoading, hasAttemptedWelcomeMessageLoad]);

  // Load and start agent when selected (Keep existing logic but wrap)
  useEffect(() => {
    let isCancelled = false;

    const loadAgent = async () => {
      // If we don't have what we need, ensure ready state is false
      if (!selectedAgent || !isKernelReady || !executeCode || !server) {
          setAgentReady(false);
          setIsWelcomeMessageLoading(false);
          setHasAttemptedWelcomeMessageLoad(false);
          return;
      }

      const agentLoadKey = `${server.config.workspace}::${selectedAgent.id}`;
      if (agentLoadCompletedKeyRef.current === agentLoadKey || agentLoadInFlightKeyRef.current === agentLoadKey) {
        return;
      }
      agentLoadInFlightKeyRef.current = agentLoadKey;
      
      // Start loading
      setAgentReady(false);
      setIsWelcomeMessageLoading(true);
      setHasAttemptedWelcomeMessageLoad(false);
      setAgentWelcomeMessage(null);

      try {
        console.log(`Loading agent ${selectedAgent.name}...`);
        
        // 1. Get the artifact
        const am = await server.getService('public/artifact-manager');
        const artifact = await am.read({
          artifact_id: selectedAgent.id,
          _rkwargs: true
        });
        
        console.log("Agent artifact:", artifact);
        
        const files = artifact.files || [];
        const manifest = artifact.manifest || {};

        // 2. Install dependencies (if any)
        // We look for a requirements.txt file to install extra dependencies
        // Also check manifest for dependencies?
        const reqFile = files.find((f: any) => f.name === 'requirements.txt');
        let packages: string[] = ["hypha-rpc", "openai"]; // Always install hypha-rpc and openai

        if (reqFile) {
            console.log("Installing dependencies from requirements.txt...");
            const reqUrl = await am.get_file({
              artifact_id: selectedAgent.id,
              file_path: reqFile.name,
              _rkwargs: true
            });
            const reqResponse = await fetch(reqUrl);
            const reqText = await reqResponse.text();
            
            // Clean up requirements (remove comments, empty lines)
            const extraPackages = reqText.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            packages = [...packages, ...extraPackages];
        }

        if (packages.length > 0) {
            const packagesJson = JSON.stringify(packages);
            const chatProxyServiceIdsLiteral = JSON.stringify(CHAT_PROXY_SERVICE_IDS)
              .replaceAll('\\', '\\\\')
              .replaceAll("'", "\\'");
            const installCode = `
import micropip
import json
import traceback
import js
import asyncio
from urllib.parse import urlparse
import httpx
from hypha_rpc import connect_to_server

try:
    packages = json.loads('${packagesJson}')
    print(f"Installing packages: {packages}")
    await micropip.install(packages)
    print("Dependencies installed successfully.")
except Exception as e:
    print(f"Error installing dependencies: {e}")

# Define the proxy function for compatibility with agents expecting js.hypha_chat_proxy

def _is_timeout_payload(payload):
  if isinstance(payload, str):
    return "timed out" in payload.lower() or "timeout" in payload.lower()
  if isinstance(payload, dict):
    err = payload.get("error") or payload.get("message")
    return isinstance(err, str) and ("timed out" in err.lower() or "timeout" in err.lower())
  return False

def _extract_timeout_seconds(timeout_value, fallback=30.0):
  if timeout_value is None:
    return float(fallback)
  if isinstance(timeout_value, (int, float)):
    return float(timeout_value)
  candidate = getattr(timeout_value, "read", None)
  if isinstance(candidate, (int, float)):
    return float(candidate)
  candidate = getattr(timeout_value, "connect", None)
  if isinstance(candidate, (int, float)):
    return float(candidate)
  return float(fallback)

def _should_proxy_request_url(url):
  try:
    parsed = urlparse(str(url))
  except Exception:
    return False
  host = (parsed.hostname or "").lower()
  return host == "beta.bioimagearchive.org"

class _ProxyHTTPXResponse:
  def __init__(self, payload, url):
    self._payload = payload or {}
    self.status_code = int(self._payload.get("status_code") or self._payload.get("status") or 500)
    self.headers = self._payload.get("headers") or {}
    self.url = self._payload.get("url") or str(url)
    self._json = self._payload.get("json")
    self._text = self._payload.get("text")

  @property
  def text(self):
    if self._text is not None:
      return self._text
    if self._json is not None:
      try:
        return json.dumps(self._json, ensure_ascii=False)
      except Exception:
        return str(self._json)
    return ""

  def json(self):
    if self._json is not None:
      return self._json
    if self._text is None:
      return {}
    return json.loads(self._text)

  def raise_for_status(self):
    if self.status_code >= 400:
      detail = self._payload.get("error")
      if isinstance(detail, str) and detail:
        raise RuntimeError(f"Server error '{self.status_code}' for url '{self.url}': {detail}")
      raise RuntimeError(f"Server error '{self.status_code}' for url '{self.url}'")

async def _resolve_proxy_service_for_utilities():
  service_ids = json.loads('${chatProxyServiceIdsLiteral}')
  server = await connect_to_server({
    "server_url": "https://hypha.aicell.io",
    "method_timeout": 600
  })

  proxy = None
  resolved_service_id = None
  last_service_error = None
  for service_id in service_ids:
    try:
      proxy = await server.get_service(service_id, {"timeout": 600})
      resolved_service_id = service_id
      break
    except BaseException as service_exp:
      last_service_error = service_exp

  if proxy is None:
    if last_service_error:
      raise last_service_error
    raise RuntimeError("No chat-proxy service IDs configured")

  print(f"DEBUG: Utility proxy resolved via {resolved_service_id}")
  return proxy

async def _proxy_request_url_via_service(url, method="GET", headers=None, timeout=30.0):
  try:
    proxy = await _resolve_proxy_service_for_utilities()
    if not hasattr(proxy, 'request_url'):
      return {
        "ok": False,
        "error": "chat-proxy service is missing request_url; deploy updated chat-proxy app",
        "status_code": 502,
        "url": str(url),
      }
    payload = await asyncio.wait_for(
      proxy.request_url(url=url, method=method, headers=headers or {}, timeout=float(timeout)),
      timeout=max(5.0, float(timeout) + 5.0)
    )
    return payload if isinstance(payload, dict) else {
      "ok": False,
      "error": f"Unexpected request_url payload type: {type(payload)}",
      "status_code": 500,
      "url": str(url),
      "text": str(payload),
    }
  except Exception as exp:
    return {
      "ok": False,
      "error": str(exp),
      "status_code": 500,
      "url": str(url),
    }

_original_asyncclient_request = globals().get('__original_asyncclient_request')

async def _patched_asyncclient_request(self, method, url, *args, **kwargs):
  if _should_proxy_request_url(url):
    timeout_seconds = _extract_timeout_seconds(kwargs.get("timeout"), 30.0)
    headers = kwargs.get("headers") or {}
    payload = await _proxy_request_url_via_service(
      str(url),
      method=str(method).upper(),
      headers=headers,
      timeout=timeout_seconds,
    )
    return _ProxyHTTPXResponse(payload, str(url))

  return await _original_asyncclient_request(self, method, url, *args, **kwargs)

def _install_httpx_proxy_patch():
  global _original_asyncclient_request
  if _original_asyncclient_request is None:
    _original_asyncclient_request = httpx.AsyncClient.request
    globals()['__original_asyncclient_request'] = _original_asyncclient_request

  already_patched = getattr(httpx.AsyncClient.request, '__name__', '') == '_patched_asyncclient_request'
  if already_patched:
    print("DEBUG: httpx CORS proxy patch already installed")
    return

  httpx.AsyncClient.request = _patched_asyncclient_request
  print("DEBUG: Installed httpx proxy patch for beta.bioimagearchive.org")

async def _python_fallback_chat_completion(messages, tools, tool_choice, model):
  last_exception = None
  service_ids = json.loads('${chatProxyServiceIdsLiteral}')
  for attempt in range(1, 3):
    try:
      print(f"DEBUG: Connecting to Hypha server for chat proxy (attempt {attempt})...")
      server = await connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "method_timeout": 600
      })

      proxy = None
      resolved_service_id = None
      last_service_error = None
      for service_id in service_ids:
        try:
          proxy = await server.get_service(service_id, {"timeout": 600})
          resolved_service_id = service_id
          break
        except BaseException as service_exp:
          last_service_error = service_exp

      if proxy is None:
        if last_service_error:
          raise last_service_error
        raise RuntimeError("No chat-proxy service IDs configured")

      print(f"DEBUG: Python fallback resolved chat-proxy service via {resolved_service_id}")

      result = await asyncio.wait_for(
        proxy.chat_completion(messages, tools, tool_choice, model),
        timeout=${Math.floor(CHAT_PROXY_REQUEST_TIMEOUT_MS / 1000)}
      )
      print("DEBUG: Python fallback chat_completion returned successfully")

      if _is_timeout_payload(result) and attempt < 2:
        print("DEBUG: Python fallback received timeout payload, retrying...")
        await asyncio.sleep(0.35 * attempt)
        continue

      return result
    except asyncio.TimeoutError as timeout_exp:
      last_exception = timeout_exp
      if attempt < 2:
        print("DEBUG: Python fallback call timed out, retrying...")
        await asyncio.sleep(0.35 * attempt)
        continue
      raise
    except BaseException as fallback_exp:
      last_exception = fallback_exp
      if attempt < 2:
        print(f"DEBUG: Python fallback error on attempt {attempt}, retrying: {fallback_exp}")
        await asyncio.sleep(0.35 * attempt)
        continue
      raise

  if last_exception:
    raise last_exception
  return {"error": "bridge-error: unknown python fallback error"}

async def hypha_chat_proxy(messages_json, tools_json, tool_choice_json, model):
  try:
    test_mode = None
    if hasattr(js, "globalThis"):
      test_mode = getattr(js.globalThis, "__chatProxyTestMode", None)

    if test_mode == "stall":
      await asyncio.sleep(3600)

    if test_mode == "upstream-error":
      return json.dumps({"error": "simulated-upstream-error"})

    messages = json.loads(messages_json)
    tools = json.loads(tools_json) if tools_json else None
    tool_choice = json.loads(tool_choice_json) if tool_choice_json and tool_choice_json != "auto" else tool_choice_json

    print(f"DEBUG: Python-only proxy path; messages={len(messages)}; model={model}")
    print(f"TRACE: proxy request messages => {json.dumps(messages, ensure_ascii=False)}")
    if tools is not None:
      print(f"TRACE: proxy request tools => {json.dumps(tools, ensure_ascii=False)}")
    if tool_choice is not None:
      print(f"TRACE: proxy tool_choice => {json.dumps(tool_choice, ensure_ascii=False)}")

    result = await _python_fallback_chat_completion(messages, tools, tool_choice, model)
    print(f"TRACE: proxy response => {json.dumps(result, ensure_ascii=False)}")
    return json.dumps(result)
  except asyncio.TimeoutError:
    return json.dumps({"error": "bridge-timeout: proxy call exceeded ${Math.floor(CHAT_PROXY_REQUEST_TIMEOUT_MS / 1000)}s"})
  except BaseException as e:
    print(f"DEBUG: Exception in hypha_chat_proxy bridge: {e}")
    traceback.print_exc()
    return json.dumps({"error": f"bridge-error: {str(e)}"})

print("DEBUG: hypha_chat_proxy bridge ready")
_install_httpx_proxy_patch()
            `;
            await executeCode(installCode);
        }

        // Agent metadata
        // `startup_script` is used as system prompt metadata in this app,
        // and `welcomeMessage` seeds new chats.
        setAgentSystemPrompt(typeof manifest.startup_script === 'string' ? manifest.startup_script : null);
        const welcomeText = typeof manifest.welcomeMessage === 'string'
          ? manifest.welcomeMessage
          : null;
        if (!isCancelled) {
          setAgentWelcomeMessage(welcomeText);
          setIsWelcomeMessageLoading(false);
          setHasAttemptedWelcomeMessageLoad(true);
          setAgentChatModel(resolveAgentChatModel(manifest));
        }

        // 3. Get startup script for kernel execution
        const startupScriptRaw = manifest.startup_script;
        if (typeof startupScriptRaw !== 'string' || !startupScriptRaw.trim()) {
          throw new Error("Agent manifest.startup_script is required.");
        }
        const scriptContent = startupScriptRaw.replace(/\r\n/g, '\n');

        console.log("Startup script content loaded.", scriptContent.substring(0, 100) + "...");

        // 4. Run the script
        await executeCode(scriptContent);

        console.log("Agent startup script executed.");
        
        if (!isCancelled) {
          setAgentReady(true);
        }
        agentLoadCompletedKeyRef.current = agentLoadKey;

        // 5. Connect to the service
        // We'll retry connecting to the service in the chat handler.

        
        // 5. Connect to the service
        // The script typically registers a service.
        // We'll retry connecting to the service in the chat handler.

      } catch (err: any) {
        if (!isCancelled) {
          setAgentReady(false);
          setIsWelcomeMessageLoading(false);
          setHasAttemptedWelcomeMessageLoad(true);
        }
        console.error("Error loading agent:", err);
        const errorMsg = {
            id: Date.now().toString(),
            role: 'system' as const,
            content: `**Error loading agent**: ${err.message}`,
            timestamp: new Date()
        };
        if (!isCancelled) {
          setMessages(prev => [...prev, errorMsg]);
        }
      } finally {
        if (agentLoadInFlightKeyRef.current === agentLoadKey) {
          agentLoadInFlightKeyRef.current = null;
        }
      }
    };

    loadAgent();

    return () => {
      isCancelled = true;
    };
  }, [selectedAgent, isKernelReady, executeCode, server]);

  
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!selectedAgent || !isKernelReady || !agentReady || isTyping) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedAgent, isKernelReady, agentReady, isTyping, sessionFromRoute, currentSessionId]);

  useEffect(() => {
    if (sessionFromRoute) return;
    if (currentSessionId !== LOCAL_DRAFT_SESSION_ID) return;
    if (messages.length > 0) return;
    const welcome = getWelcomeMessages();
    if (welcome.length > 0) {
      setMessages(welcome);
    }
  }, [currentSessionId, sessionFromRoute, agentWelcomeMessage, isWelcomeMessageLoading, hasAttemptedWelcomeMessageLoad, messages.length]);

  // Expose proxy wrapper to Python environment
  useEffect(() => {
    // Only set up the proxy when the server is connected and available
    if (server) {
      console.log("AgentPage: Registering hypha_chat_proxy...");
      activeChatProxyServiceIdRef.current = CHAT_PROXY_SERVICE_ID;
      (globalThis as any).__chatProxyServiceId = activeChatProxyServiceIdRef.current;
      let cachedChatProxyService: any = null;
      let cachedChatProxyServiceId: string | null = null;
      (globalThis as any).hypha_chat_proxy = async (messages: string | any, tools: string | any, tool_choice: string | any, model: string) => {
        try {
           const testMode = (globalThis as any).__chatProxyTestMode;
           if (testMode === 'stall') {
             await new Promise(() => {
             });
           }
           if (testMode === 'upstream-error') {
             return JSON.stringify({ error: 'simulated-upstream-error' });
           }

           const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> => {
             return await new Promise<T>((resolve, reject) => {
               const timer = globalThis.setTimeout(() => {
                 reject(new Error(`Timeout after ${Math.floor(timeoutMs / 1000)}s during ${stage}`));
               }, timeoutMs);

               promise
                 .then((value) => {
                   globalThis.clearTimeout(timer);
                   resolve(value);
                 })
                 .catch((error) => {
                   globalThis.clearTimeout(timer);
                   reject(error);
                 });
             });
           };

           const isTimeoutPayload = (payload: any): boolean => {
             if (!payload) return false;
             if (typeof payload === 'string') {
               return /request timed out|timed out|timeout/i.test(payload);
             }
             if (typeof payload === 'object') {
               const maybeError = payload.error ?? payload.message;
               return typeof maybeError === 'string' && /request timed out|timed out|timeout/i.test(maybeError);
             }
             return false;
           };

           const resolveChatProxyService = async (forceRefresh: boolean = false, preferAlternateService: boolean = false) => {
             if (!forceRefresh && cachedChatProxyService && cachedChatProxyServiceId) {
               return cachedChatProxyService;
             }

             let lastError: Error | null = null;
             const preferredServiceIds = uniqueNonEmptyValues([
               activeChatProxyServiceIdRef.current,
               ...CHAT_PROXY_SERVICE_IDS,
             ]);
             const prioritizedServiceIds = preferAlternateService && preferredServiceIds.length > 1
               ? [...preferredServiceIds.slice(1), preferredServiceIds[0]]
               : preferredServiceIds;
             for (let attempt = 1; attempt <= 3; attempt += 1) {
               for (const serviceId of prioritizedServiceIds) {
                 try {
                   const resolved: any = await withTimeout(
                     server.getService(serviceId, { timeout: 600 }),
                     CHAT_PROXY_RESOLVE_TIMEOUT_MS,
                     `service resolution for ${serviceId} (attempt ${attempt})`
                   );
                   if (!resolved || typeof resolved.chat_completion !== 'function') {
                     throw new Error(`Proxy service found but has no chat_completion method: ${serviceId}`);
                   }
                   cachedChatProxyService = resolved;
                   cachedChatProxyServiceId = serviceId;
                   activeChatProxyServiceIdRef.current = serviceId;
                   (globalThis as any).__chatProxyServiceId = serviceId;
                   return resolved;
                 } catch (resolveError: any) {
                   lastError = resolveError instanceof Error ? resolveError : new Error(String(resolveError));
                 }
               }
               if (attempt < 3) {
                 await new Promise(resolve => setTimeout(resolve, 400 * attempt));
               }
             }
             throw lastError || new Error(`Unable to resolve chat proxy service from candidates: ${prioritizedServiceIds.join(', ')}`);
           };

           console.log("AgentPage: hypha_chat_proxy called with model:", model);
           const args = {
              messages: typeof messages === 'string' ? JSON.parse(messages) : messages,
              tools: tools ? (typeof tools === 'string' ? JSON.parse(tools) : tools) : null,
              tool_choice: tool_choice ? (typeof tool_choice === 'string' ? JSON.parse(tool_choice) : tool_choice) : null,
              model
           };
           
             console.log("AgentPage: Resolving chat proxy service...");
             const proxy: any = await resolveChatProxyService();

             if (!proxy) {
              throw new Error('Unable to resolve chat proxy service.');
             }

           console.log("AgentPage: invoking chat_completion...");
           // Ensure proxy is valid before calling
           if (!proxy || typeof proxy.chat_completion !== 'function') {
               throw new Error("Proxy service found but has no chat_completion method.");
           }

           let result: any = null;
           let completionError: Error | null = null;
           for (let attempt = 1; attempt <= 3; attempt += 1) {
             try {
               const preferAlternateService = attempt > 1;
               const proxyForAttempt: any = attempt === 1
                 ? proxy
                 : await resolveChatProxyService(true, preferAlternateService);
               result = await withTimeout(
                 proxyForAttempt.chat_completion(args.messages, args.tools, args.tool_choice, args.model),
                 CHAT_PROXY_COMPLETION_TIMEOUT_MS,
                 `chat_completion response attempt ${attempt} from ${(globalThis as any).__chatProxyServiceId || CHAT_PROXY_SERVICE_ID}`
               );

               if (isTimeoutPayload(result) && attempt < 3) {
                 completionError = new Error('Request timed out from chat proxy; retrying with alternate service if available.');
                 await new Promise(resolve => setTimeout(resolve, 350));
                 continue;
               }

               completionError = null;
               break;
             } catch (attemptError: any) {
               completionError = attemptError instanceof Error ? attemptError : new Error(String(attemptError));
               const isTimeoutError = /timed out|timeout/i.test(completionError.message || '');
               if (attempt < 3 && isTimeoutError) {
                 await new Promise(resolve => setTimeout(resolve, 350));
                 continue;
               }
               if (attempt < 3 && !isTimeoutError) {
                 await new Promise(resolve => setTimeout(resolve, 350));
                 continue;
               }
             }
           }

           if (completionError) {
             throw completionError;
           }

           if (isTimeoutPayload(result)) {
             throw new Error('Request timed out.');
           }
           console.log("AgentPage: chat_completion result:", result);
           
           return JSON.stringify(result);
        } catch (e: any) {
          console.error("Error in hypha_chat_proxy:", e);
          const errorMsg = e.message || String(e);
          // Return the error in a clean JSON format for the python wrapper to parse
          return JSON.stringify({ error: errorMsg });
        }
      };
      (globalThis as any).__pyodide_chat_proxy_bridge = (globalThis as any).hypha_chat_proxy;
    } else {
        console.log("AgentPage: Server not ready, hypha_chat_proxy not registered.");
        // Clear it if server disconnects to avoid stale calls
      (globalThis as any).__chatProxyServiceId = undefined;
        (globalThis as any).hypha_chat_proxy = undefined;
        (globalThis as any).__pyodide_chat_proxy_bridge = undefined;
    }
  }, [server]);

  // Connect implicitly if not connected
  useEffect(() => {
    if (!isConnected && !isConnecting && !server) {
      console.log("AgentPage: Connecting anonymously to Hypha...");
      connect({ server_url: "https://hypha.aicell.io", method_timeout: 600 }).catch(err => {
        console.error("AgentPage: Failed to connect anonymously:", err);
        setAgentError("Failed to connect to AI Agent server.");
      });
    }
  }, [isConnected, isConnecting, server, connect]);

  useEffect(() => {
    const fetchAgents = async () => {
      if (!server) return;
      
      setLoadingAgents(true);
      setAgentError(null);
      try {
        console.log("AgentPage: Fetching agents...");
        const am = await server.getService('public/artifact-manager');
        // Fetch from the specific collection for agents
        // We need to pass positional arguments correctly to the list function in JS
        // list(parent_id, keywords, filters, limit, offset, order_by, pagination, context)
        // Since we can't easily pass keyword args, we use positional args with undefined for defaults
           const initialAgents = await am.list({
             parent_id: 'hypha-agents/agents',
             limit: 100,
             _rkwargs: true
           });
        console.log("AgentPage: Agents found:", initialAgents);

        // We assume all found agents are "online" (available to start via proxy)
        const mappedAgents: Agent[] = initialAgents.map((art: any) => {
          const serviceId = art.alias ? `hypha-agents/${art.alias}` : undefined;
          
          return {
            id: art.id, // Use full ID for connection
            name: art.manifest?.name || art.alias || 'Unnamed Agent',
            description: art.manifest?.description || 'No description provided.',
            icon: art.manifest?.icon,
            status: 'online', // Always available via Engine
            service_id: serviceId
          };
        });

        setAgents(mappedAgents);
        setLoadingAgents(false);
        
        // Use a functional update or separate effect to set initial agent to avoid dependency loop
        if (mappedAgents.length > 0) {
            setSelectedAgent(prev => {
                if (!prev) {
                    const targetAgentAlias = 'grammatical-deduction-bury-enormously';
                    const defaultAgent = mappedAgents.find(a => a.id.includes(targetAgentAlias));
                    return defaultAgent || mappedAgents[0];
                }
                return prev;
            });
        }
      } catch (err: any) {
        console.error("Error fetching agents:", err);
        setAgentError("Failed to load agents. Please check connection.");
        setLoadingAgents(false);
      }
    };

    if (isConnected && server) {
        fetchAgents();
    }
  }, [server, isConnected]);

  // Removed automatic message reset on agent change to support switching agents mid-chat.


  const handleCancel = async () => {
    if (interruptKernel) {
      await interruptKernel();
      setIsTyping(false);
      setTypingSessionKey(null);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: '*Request cancelled by user.*',
        timestamp: new Date()
      }]);
    }
  };

  const handleEditMessage = async (msg: Message) => {
    if (msg.role !== 'user') return;
    
    const index = messages.findIndex(m => m.id === msg.id);
    if (index === -1) return;
    
    const subsequentMessages = messages.slice(index + 1);
    if (subsequentMessages.length > 0) {
        if (!window.confirm("Editing this message will clear all subsequent messages. Continue?")) {
            return;
        }
    }
    
    const truncatedMessages = messages.slice(0, index);
    setInput(msg.content);
    setMessages(truncatedMessages);

    const persistedSessionId = currentSessionId;
    const canPersistEditedThread =
      Boolean(server) &&
      Boolean(selectedAgent) &&
      Boolean(persistedSessionId) &&
      persistedSessionId !== LOCAL_DRAFT_SESSION_ID &&
      persistedSessionId!.startsWith(`${server!.config.workspace}/`);

    if (canPersistEditedThread && persistedSessionId && selectedAgent) {
      await saveSession(persistedSessionId, truncatedMessages, selectedAgent.id);
    }
  };

  const isMessageExpandable = (msg: Message) => {
    if (msg.role === 'user') return false;
    const lineCount = msg.content.split('\n').length;
    return msg.content.length > MAX_COLLAPSED_MESSAGE_CHARS || lineCount > MAX_COLLAPSED_MESSAGE_LINES;
  };

  const updateAgentProgress = (summary: string, detail?: string) => {
    agentProgressRef.current = summary;
    setAgentProgress(summary);
    if (!detail) return;
    const nextDetails = [...agentProgressDetailsRef.current, detail].slice(-MAX_PROGRESS_TRACE_DETAILS);
    agentProgressDetailsRef.current = nextDetails;
    setAgentProgressDetails(prev => {
      const next = [...prev, detail];
      return next.slice(-MAX_PROGRESS_TRACE_DETAILS);
    });
  };

  const buildProgressTraceSnapshot = () => {
    const summary = agentProgressRef.current;
    const details = [...agentProgressDetailsRef.current];
    if (!summary && details.length === 0) {
      return undefined;
    }
    return {
      summary,
      details,
    };
  };

  const parseProgressFromStdout = (rawContent: string) => {
    const lines = rawContent
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (line.includes('__RESPONSE_START__:')) {
        updateAgentProgress('Finalizing response...', 'Final response received.');
        continue;
      }
      if (line.startsWith('Discovered ')) {
        updateAgentProgress('Discovering available tools...', line);
        continue;
      }
      if (line.startsWith('Calling tool:')) {
        updateAgentProgress('Running a tool call...', line);
        continue;
      }
      if (line.includes('DEBUG: Calling hypha_chat_proxy')) {
        updateAgentProgress('Contacting chat proxy service...', line);
        continue;
      }
      if (line.includes('DEBUG: hypha_chat_proxy returned:')) {
        updateAgentProgress('Processing model response...', line);
        continue;
      }
      if (line.includes('bridge-error')) {
        updateAgentProgress('Chat proxy bridge reported an error.', line);
        continue;
      }
      if (line.startsWith('DEBUG: Exception in hypha_chat_proxy bridge:')) {
        updateAgentProgress('Chat proxy bridge exception.', line);
      }
    }
  };

  const generateTitle = async (messages: Message[], sessionId: string, agentId: string, model: string) => {
      // Find the first user message
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (!firstUserMsg || !server || !sessionId) return;
      
      try {
          console.log("Generating title for session...", sessionId);
          const systemMsg = { role: "system", content: "Generate a short, concise, 3-5 word title for this chat based on the user's message. Do not use quotes. Output only the title." };
          const userMsg = { role: "user", content: firstUserMsg.content };
          
          const msgs = [systemMsg, userMsg];
          const msgsJson = JSON.stringify(msgs);
          
           if ((window as any).hypha_chat_proxy) {
             const titleModel = (model || DEFAULT_CHAT_MODEL).trim();
             const resultJson = await (window as any).hypha_chat_proxy(msgsJson, null, null, titleModel);
             const result = JSON.parse(resultJson);
             if (result.choices && result.choices[0]) {
                 const title = result.choices[0].message.content.trim().replace(/^"|"$/g, '');
                 if (title) {
                     console.log("Generated title:", title);
                     await saveSession(sessionId, messages, agentId, title);
                 }
             }
          }
      } catch (e) {
          console.error("Error generating title:", e);
      }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !selectedAgent || !server) return;

    let requestSessionKey = getSessionKey(currentSessionId);

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    setInput('');
    setIsTyping(true);
    setTypingSessionKey(requestSessionKey);
    setAgentProgress('Preparing request...');
    agentProgressRef.current = 'Preparing request...';
    setAgentProgressDetails([]);
    agentProgressDetailsRef.current = [];
    setShowAgentProgressDetails(false);

    const requestStartedAt = Date.now();
    const progressHeartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - requestStartedAt) / 1000);
      updateAgentProgress(
        `Still working... (${elapsedSeconds}s)`,
        `Waiting for model/proxy response for ${elapsedSeconds}s`
      );
    }, 10000);

    try {
      const conversationWithUser = [...messages, newMessage];
      // Prepare history for Python
      const history = messages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content }));

        if (agentSystemPrompt) {
          history.unshift({ role: 'system', content: agentSystemPrompt });
        }

      history.unshift({
        role: 'system',
        content: 'When tools/functions are available, prefer calling them to retrieve concrete results. Do not claim inability if a relevant tool exists.'
      });
      
      // Add the new message
      history.push({ role: newMessage.role, content: newMessage.content });
      
      // Save Session Logic
      let activeSessionId = currentSessionId === LOCAL_DRAFT_SESSION_ID ? null : currentSessionId;
      
      // Force fork check before saving (though saveSession handles it, we want the new ID for title gen)
      // Actually saveSession returns the ID, so we use that.
      
      if (activeSessionId) {
          // Check if we need to fork (if viewing shared session)
          if (activeSessionId.includes('/') && !activeSessionId.startsWith(server.config.workspace + '/')) {
               console.log("Forking shared session...");
               // Reset to null effectively for saveSession, but we pass current just in case it needs ref (it doesn't currently)
               // saveSession handles the fork logic if passed a foreign ID
                 const newId = await saveSession(activeSessionId, conversationWithUser, selectedAgent.id);
               if (newId) {
                   setCurrentSessionId(newId);
                   activeSessionId = newId;
                   requestSessionKey = newId;
                   setTypingSessionKey(newId);
               }
          } else {
               // Update existing owned session
               await saveSession(activeSessionId, conversationWithUser, selectedAgent.id);
          }
      } else {
          // Create new session
            const newId = await saveSession(null, conversationWithUser, selectedAgent.id);
          if (newId) {
              setCurrentSessionId(newId);
              activeSessionId = newId;
              requestSessionKey = newId;
              setTypingSessionKey(newId);
          }
      }
      
      // Trigger title generation in background if this is the first few messages
      if (messages.length < 2 && activeSessionId) {
           // We don't await this to keep UI responsive
         generateTitle(conversationWithUser, activeSessionId, selectedAgent.id, agentChatModel || DEFAULT_CHAT_MODEL); 
      }
      
      const historyJsonBase64 = toBase64Utf8(JSON.stringify(history));
      const chatModel = (agentChatModel || DEFAULT_CHAT_MODEL).replaceAll('\\', '\\\\').replaceAll("'", "\\'");

        const runChatExecution = async (): Promise<string> => {
          return await new Promise<string>(async (resolve, reject) => {
            let settled = false;
            let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

            const cleanup = () => {
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
              }
            };

            const safeResolve = (value: string) => {
              if (settled) return;
              settled = true;
              cleanup();
              updateAgentProgress('Response received.');
              resolve(value);
            };

            const safeReject = (error: Error) => {
              if (settled) return;
              settled = true;
              cleanup();
              updateAgentProgress('Request failed.', error.message || 'Unknown error while executing chat.');
              reject(error);
            };

            timeoutHandle = setTimeout(() => {
              safeReject(
                new Error(
                  `Chat request timed out after ${Math.floor(CHAT_PROXY_REQUEST_TIMEOUT_MS / 1000)}s while waiting for ${CHAT_PROXY_SERVICE_ID}`
                )
              );
            }, CHAT_PROXY_REQUEST_TIMEOUT_MS);

            const code = `
import asyncio
import js
import json
import traceback
import inspect
import base64

# Helper to send response safely
def send_response(data):
    print(f"__RESPONSE_START__:{json.dumps(data)}")

_EXCLUDED_TOOL_NAMES = {
  'send_response', '_chat_wrapper', '_discover_tools',
  'exit', 'quit', 'get_ipython', 'open', 'print', 'help',
  'AsyncOpenAI', 'traceback', 'inspect', 'json', 'js', 'asyncio',
  'hypha_chat_proxy', 'base64'
}

def _discover_tools():
  cached_tool_specs = globals().get('__cached_tool_specs')
  cached_tool_names = globals().get('__cached_tool_names')
  available_functions = {}

  if isinstance(cached_tool_specs, list) and isinstance(cached_tool_names, list):
    for tool_name in cached_tool_names:
      func = globals().get(tool_name)
      if func and (inspect.isfunction(func) or inspect.iscoroutinefunction(func)):
        available_functions[tool_name] = func
    if len(available_functions) == len(cached_tool_names):
      return cached_tool_specs, available_functions, True

  tools = []
  discovered_names = []
  for name, func in globals().items():
    is_user_function = (
      (inspect.isfunction(func) or inspect.iscoroutinefunction(func))
      and getattr(func, '__module__', None) == '__main__'
    )
    if not is_user_function or name.startswith('_') or name in _EXCLUDED_TOOL_NAMES:
      continue

    doc = inspect.getdoc(func) or "No description provided."

    try:
      sig = inspect.signature(func)
    except Exception:
      continue

    params_schema = {"type": "object", "properties": {}, "required": []}
    for param_name, param in sig.parameters.items():
      param_type = "string"
      if param.annotation != inspect.Parameter.empty:
        if param.annotation == int:
          param_type = "integer"
        elif param.annotation == float:
          param_type = "number"
        elif param.annotation == bool:
          param_type = "boolean"

      params_schema["properties"][param_name] = {"type": param_type}
      if param.default == inspect.Parameter.empty:
        params_schema["required"].append(param_name)

    tools.append({
      "type": "function",
      "function": {
        "name": name,
        "description": doc,
        "parameters": params_schema
      }
    })
    available_functions[name] = func
    discovered_names.append(name)

  globals()['__cached_tool_specs'] = tools
  globals()['__cached_tool_names'] = discovered_names
  return tools, available_functions, False

async def _chat_wrapper():
    try:
        history_json = base64.b64decode('${historyJsonBase64}').decode('utf-8')
        messages = json.loads(history_json)
        
        # Discover tools from globals once and cache in kernel scope
        tools, available_functions, reused_cached_tools = _discover_tools()
        if tools:
          if reused_cached_tools:
            print(f"Reusing cached tools: {[t['function']['name'] for t in tools]}")
          else:
            print(f"Discovered {len(tools)} tools: {[t['function']['name'] for t in tools]}")
        
        # Prepare arguments for hypha_chat_proxy
        # It expects JSON strings
        messages_json = json.dumps(messages)
        tools_json = json.dumps(tools) if tools else None
        tool_choice_json = json.dumps("auto") if tools else None
        
        print("DEBUG: Calling hypha_chat_proxy internal function...")
        # Route through JS wrapper via Python bridge
        result_json = await hypha_chat_proxy(
            messages_json, 
            tools_json, 
            tool_choice_json, 
          '${chatModel}'
        )
        print(f"DEBUG: hypha_chat_proxy returned: {result_json[:100]}...")
        
        try:
          result = json.loads(result_json)
        except Exception as parse_err:
          send_response({"text": f"Error from proxy: Invalid JSON response ({parse_err})"})
          return
        
        if isinstance(result, dict) and "error" in result:
             send_response({"text": f"Error from proxy: {result['error']}"})
             return

        choice = result['choices'][0]
        response_message = choice['message']
        tool_calls = response_message.get('tool_calls')
        content = response_message.get('content')
        
        max_turns = ${AGENT_TOOL_EXECUTION_LIMIT}
        soft_timeout_ms = ${AGENT_ITERATION_SOFT_TIMEOUT_MS}
        soft_deadline = asyncio.get_event_loop().time() + (soft_timeout_ms / 1000.0)
        turns = 0
        tool_result_cache = {}
        total_tool_calls = 0
        successful_tool_calls = 0
        successful_tool_results = []
        timeout_finalize_requested = False

        def _short_text(value, max_len=400):
          text = str(value)
          if len(text) <= max_len:
            return text
          return text[:max_len] + "..."

        def _summarize_tool_results():
          if not successful_tool_results:
            return None

          lines = ["I executed the available tool(s) and collected these results:"]
          for index, item in enumerate(successful_tool_results[:5], start=1):
            tool_name = item.get('name') or 'tool'
            tool_output = item.get('output')
            lines.append(f"{index}. {tool_name}: {_short_text(tool_output, 600)}")

          if len(successful_tool_results) > 5:
            lines.append(f"...and {len(successful_tool_results) - 5} more tool result(s).")

          return "\\n".join(lines)

        while True:
          tool_calls = response_message.get('tool_calls')
          content = response_message.get('content')

          if not tool_calls:
            send_response({"text": content})
            return

          if turns >= max_turns:
            send_response({"text": "I reached the tool execution limit before finishing. Please try again."})
            return

          messages.append(response_message)

          for tool_call in tool_calls:
            total_tool_calls += 1
            function_name = tool_call['function']['name']
            args_content = tool_call['function']['arguments']

            try:
              if isinstance(args_content, str):
                function_args = json.loads(args_content)
              else:
                function_args = args_content
            except Exception as arg_err:
              messages.append({
                "tool_call_id": tool_call.get('id', 'unknown-tool-call-id'),
                "role": "tool",
                "name": function_name,
                "content": f"Error: Invalid tool arguments for '{function_name}': {str(arg_err)}",
              })
              continue

            tool_call_id = tool_call['id']
            function_to_call = available_functions.get(function_name)

            if function_to_call:
              print(f"Calling tool: {function_name}({function_args})")
              try:
                cache_key = f"{function_name}:{json.dumps(function_args, sort_keys=True, ensure_ascii=False)}"
                if cache_key in tool_result_cache:
                  function_response = tool_result_cache[cache_key]
                  print(f"Using cached tool result: {function_name}")
                else:
                  if inspect.iscoroutinefunction(function_to_call):
                    function_response = await function_to_call(**function_args)
                  else:
                    function_response = function_to_call(**function_args)
                  tool_result_cache[cache_key] = function_response

                function_response_text = str(function_response)
                successful_tool_calls += 1
                successful_tool_results.append({
                  "name": function_name,
                  "output": function_response_text,
                })

                messages.append({
                  "tool_call_id": tool_call_id,
                  "role": "tool",
                  "name": function_name,
                  "content": function_response_text,
                })
              except Exception as e:
                error_text = str(e)
                messages.append({
                  "tool_call_id": tool_call_id,
                  "role": "tool",
                  "name": function_name,
                  "content": f"Error: {error_text}",
                })
            else:
              messages.append({
                "tool_call_id": tool_call_id,
                "role": "tool",
                "name": function_name,
                "content": f"Error: Tool '{function_name}' is not available.",
              })

          if asyncio.get_event_loop().time() >= soft_deadline and not timeout_finalize_requested:
            timeout_finalize_requested = True
            messages.append({
              "role": "system",
              "content": f"You have been working for about {int(soft_timeout_ms / 1000)} seconds. Provide the best possible final answer now using the tool results and errors already collected. Do not call additional tools unless absolutely necessary.",
            })

          turns += 1
          next_tools_json = json.dumps(tools) if tools else None
          next_tool_choice = "none" if timeout_finalize_requested else "auto"
          next_tool_choice_json = json.dumps(next_tool_choice) if tools else None
          next_result_json = await hypha_chat_proxy(
            json.dumps(messages),
            next_tools_json,
            next_tool_choice_json,
            '${chatModel}'
          )
          try:
            next_result = json.loads(next_result_json)
          except Exception as parse_err:
            if successful_tool_calls > 0:
              summary_text = _summarize_tool_results()
              if isinstance(summary_text, str) and summary_text:
                send_response({"text": f"{summary_text}\\n\\nI’m returning the best results gathered so far because a follow-up model response could not be parsed ({parse_err})."})
                return
            send_response({"text": f"Error from proxy: Invalid JSON response ({parse_err})"})
            return

          if isinstance(next_result, dict) and "error" in next_result:
            if successful_tool_calls > 0:
              summary_text = _summarize_tool_results()
              if isinstance(summary_text, str) and summary_text:
                send_response({"text": f"{summary_text}\\n\\nI’m returning the best results gathered so far because the follow-up model call failed: {next_result['error']}"})
                return
            send_response({"text": f"Error from proxy: {next_result['error']}"})
            return

          response_message = next_result['choices'][0]['message']

    except Exception as e:
        traceback.print_exc()
        send_response({"text": f"Error executing chat: {str(e)}"})

await _chat_wrapper()
`;
            if (executeCode) {
              await executeCode(code, {
                     onOutput: (log) => {
                  if (log.type === 'error') {
                    safeReject(new Error(log.content || 'Kernel execution error'));
                    return;
                  }
                        if (log.type === 'stdout') {
                            const content = log.content;
                            parseProgressFromStdout(content);
                            if (content.includes('__RESPONSE_START__:')) {
                                 const parts = content.split('__RESPONSE_START__:');
                                 if (parts.length > 1) {
                                     try {
                                         let jsonStr = parts[1].trim();
                                         const parsed = JSON.parse(jsonStr);
                                         safeResolve(typeof parsed === 'string' ? parsed : (parsed.text || JSON.stringify(parsed)));
                                     } catch (e) {
                                         safeResolve(parts[1].trim());
                                     }
                                 }
                            }
                        }
                        if (log.type === 'stderr' && log.content) {
                          const stderr = log.content.trim();
                          if (stderr) {
                            updateAgentProgress('Agent emitted runtime logs...', stderr);
                          }
                        }
                         },
                         onStatus: (status) => {
                          if (status === 'Busy') {
                            updateAgentProgress('Running in Python kernel...');
                          }
                          if (status === 'Error') {
                            safeReject(new Error('Kernel execution failed while sending message.'));
                          }
                     }
                 });
            }

                if (!executeCode) {
                  safeResolve("No response from agent (execution unavailable).");
                }
            });
        };

        let pythonResponse = '';
        const maxExecutionAttempts = 3;
        let lastExecutionError: Error | null = null;
        for (let attempt = 1; attempt <= maxExecutionAttempts; attempt += 1) {
          try {
            if (attempt > 1) {
              updateAgentProgress('Retrying after kernel error...', `Execution attempt ${attempt}/${maxExecutionAttempts}`);
            }
            pythonResponse = await runChatExecution();
            lastExecutionError = null;
            break;
          } catch (executionError: any) {
            lastExecutionError = executionError instanceof Error ? executionError : new Error(String(executionError));
            const errorText = String(lastExecutionError.message || lastExecutionError);
            updateAgentProgress('Execution error encountered.', errorText);
            const isRetriableError = /SyntaxError|expected 'except' or 'finally'|invalid syntax|timed out|bridge-timeout|proxy bridge unavailable/i.test(errorText);
            if (!isRetriableError || attempt >= maxExecutionAttempts) {
              break;
            }
            try {
              await interruptKernel?.();
            } catch {
            }
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        if (lastExecutionError) {
          throw lastExecutionError;
        }

        const responseText = pythonResponse;
        const progressTrace = buildProgressTraceSnapshot();
        const responseMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: responseText,
            timestamp: new Date(),
          progressTrace,
        };
        const finalConversation = [...conversationWithUser, responseMessage];
        if (activeSessionId) {
          saveSession(activeSessionId, finalConversation, selectedAgent.id);
        }
        if (currentSessionKeyRef.current === requestSessionKey) {
          setMessages(finalConversation);
        }

    } catch (error: any) {
      console.error("Error sending message:", error);
      const errorResponse: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `**Error**: ${error.message || 'Unknown error occurred during chat.'}`,
        timestamp: new Date(),
        progressTrace: buildProgressTraceSnapshot(),
      };
      updateAgentProgress('Request failed.', error.message || 'Unknown error occurred during chat.');
      if (currentSessionKeyRef.current === requestSessionKey) {
        setMessages(prev => [...prev, errorResponse]);
      }
    } finally {
        clearInterval(progressHeartbeat);
        setIsTyping(false);
        setTypingSessionKey(null);
    }
  };

  const markdownComponents = {
    code: CodeBlock,
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    (() => {
      const currentSessionKey = getSessionKey(currentSessionId);
      const showTypingForCurrentChat = isTyping && typingSessionKey === currentSessionKey;
      const showWelcomeBufferForCurrentChat =
        !showTypingForCurrentChat &&
        !sessionFromRoute &&
        messages.length === 0 &&
        isWelcomeMessageLoading;
      return (
    <div className="flex h-[calc(100vh-80px)] bg-gray-50 relative overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Sessions */}
      <div className={`
        absolute inset-y-0 left-0 z-30 w-80 bg-white border-r border-gray-200 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center">
                <FiMessageSquare className="mr-2 text-ri-orange" size={20} />
                <h2 className="font-semibold text-lg text-gray-800">Chats</h2>
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={handleNewChat}
                    className="p-2 bg-ri-orange text-white rounded-lg hover:bg-orange-600 transition-colors"
                    title="New Chat"
                >
                    <FiPlus size={20} />
                </button>
                <button 
                  className="md:hidden p-2 text-gray-500 hover:text-gray-700"
                  onClick={() => setIsSidebarOpen(false)}
                >
                  <FiX size={20} />
                </button>
            </div>
        </div>
        
        {loadingSessions && <div className="p-4 text-xs text-center text-gray-400">Loading chats...</div>}

        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {!isLoggedIn ? (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <FiUser className="text-gray-300 mb-2" size={32} />
              <p className="text-sm text-gray-500 mb-4">Sign in to save your chat history</p>
              <div className="w-full flex justify-center">
                <LoginButton className="w-auto" />
              </div>
            </div>
          ) : (
            <>
              {sessions.map(session => {
              const isLocalDraft = session.id === LOCAL_DRAFT_SESSION_ID;
              return (
            <div
              key={session.id}
              className={`w-full text-left p-3 rounded-lg border transition-all duration-200 flex items-center justify-between group
                ${currentSessionId === session.id 
                  ? 'border-ri-orange bg-orange-50 ring-1 ring-ri-orange' 
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              <button 
                  onClick={() => loadSession(session.id)}
                  className="flex-1 min-w-0 text-left mr-2"
              >
                  {editingSessionId === session.id && !isLocalDraft ? (
                      <input 
                          type="text" 
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => {
                              if (editingTitle.trim()) {
                                  saveSession(session.id, messages, session.agentId, editingTitle);
                              }
                              setEditingSessionId(null);
                          }}
                          onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                  if (editingTitle.trim()) {
                                      saveSession(session.id, messages, session.agentId, editingTitle);
                                  }
                                  setEditingSessionId(null);
                              }
                          }}
                          autoFocus
                          className="w-full text-sm font-medium border-none bg-transparent p-0 focus:ring-0"
                      />
                  ) : (
                      <>
                        <p className="font-medium text-gray-900 truncate">{session.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                            {new Date(session.lastModified).toLocaleDateString()}
                        </p>
                      </>
                  )}
              </button>
              
                {!isLocalDraft && (
                <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 transition-opacity">
                  <button
                      onClick={() => {
                          setEditingTitle(session.title);
                          setEditingSessionId(session.id);
                      }}
                      className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-200"
                      title="Rename"
                  >
                      <FiEdit2 size={12} />
                  </button>
                  <button
                      onClick={() => deleteSession(session.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50"
                      title="Delete"
                  >
                      <FiTrash2 size={12} />
                  </button>
              </div>
              )}
            </div>
              );
            })}
          {!loadingSessions && sessions.length === 0 && (
              <div className="text-center p-8 text-gray-400 text-sm">
                  <p>No chat history.</p>
                  <button onClick={handleNewChat} className="text-ri-orange hover:underline mt-2">Start a new chat</button>
              </div>
          )}
            </>
          )}

        </div>
        
        <div className="p-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 text-center">
            Powered by Hypha
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <div className="md:hidden bg-white px-4 py-3 border-b border-gray-200 flex items-center space-x-3 shadow-sm z-20">
             <button
               className="p-2 -ml-2 text-gray-500 hover:text-gray-700"
               onClick={() => setIsSidebarOpen(true)}
             >
               <FiMenu size={24} />
             </button>
             <span className="font-semibold text-gray-700">Model Hub Chat</span>
             {selectedAgent && (
                 <span className="text-xs bg-orange-100 text-ri-orange px-2 py-0.5 rounded-full truncate max-w-[120px]">
                     {selectedAgent.name}
                 </span>
             )}
        </div>
        
        {selectedAgent ? (
          <>
            {/* Header */}
            <div className="bg-white px-6 py-3 border-b border-gray-200 flex items-center justify-between shadow-sm z-10 hidden md:flex">
              <div className="flex items-center space-x-3">
                <Menu as="div" className="relative inline-block text-left">
                    <div>
                        <MenuButton className="inline-flex justify-center w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white rounded-md hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 items-center space-x-2 border border-gray-200 shadow-sm">
                            <div className="p-1 bg-orange-100 rounded-full text-ri-orange">
                                {selectedAgent.icon ? <img src={selectedAgent.icon} alt="" className="w-4 h-4 object-cover rounded-full" /> : <FiCpu size={16} />}
                            </div>
                            <span className="font-bold text-gray-800">{selectedAgent.name}</span>
                            <FiChevronDown
                                className="w-5 h-5 ml-2 -mr-1 text-gray-400 hover:text-gray-600"
                                aria-hidden="true"
                            />
                        </MenuButton>
                    </div>
                    <Transition
                        as={Fragment}
                        enter="transition ease-out duration-100"
                        enterFrom="transform opacity-0 scale-95"
                        enterTo="transform opacity-100 scale-100"
                        leave="transition ease-in duration-75"
                        leaveFrom="transform opacity-100 scale-100"
                        leaveTo="transform opacity-0 scale-95"
                    >
                        <MenuItems className="absolute left-0 w-72 mt-2 origin-top-left bg-white divide-y divide-gray-100 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50 max-h-96 overflow-y-auto">
                            <div className="px-1 py-1 ">
                                {agents.map((agent) => (
                                    <MenuItem key={agent.id}>
                                        {({ active }) => (
                                            <button
                                                onClick={() => setSelectedAgent(agent)}
                                                className={`${
                                                    active ? 'bg-orange-50 text-ri-orange' : 'text-gray-900'
                                                } group flex rounded-md items-center w-full px-2 py-2 text-sm space-x-2`}
                                            >
                                                <div className="p-1 bg-gray-100 rounded-full text-gray-500">
                                                    {agent.icon ? <img src={agent.icon} alt="" className="w-4 h-4 object-cover rounded-full" /> : <FiCpu size={14} />}
                                                </div>
                                                <div className="flex flex-col items-start overflow-hidden">
                                                    <span className="font-medium truncate w-full text-left">{agent.name}</span>
                                                    <span className="text-xs text-gray-400 truncate w-full text-left">{agent.description}</span>
                                                </div>
                                                {selectedAgent.id === agent.id && (
                                                    <span className="ml-auto text-ri-orange text-xs font-bold">✓</span>
                                                )}
                                            </button>
                                        )}
                                    </MenuItem>
                                ))}
                            </div>
                        </MenuItems>
                    </Transition>
                </Menu>
                
                <div className="flex items-center space-x-2 border-l border-gray-200 pl-3">
                    <p className={`text-xs flex items-center ${selectedAgent.status === 'online' ? 'text-green-600' : 'text-red-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${selectedAgent.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                        {' '}
                        {selectedAgent.status === 'online' ? 'Online' : 'Offline'}
                    </p>
                    {isKernelReady && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex items-center">
                            <FiZap size={10} className="mr-1" /> Client Kernel
                        </span>
                    )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                 <button 
                  onClick={handleShareSession} 
                  className={`text-gray-400 hover:text-purple-500 transition-colors p-2 rounded-full hover:bg-purple-50`}
                  title="Share Session"
                >
                  <FiShare2 size={18} />
                </button>
                 <button 
                  onClick={() => setShowLogs(!showLogs)}  
                  className={`text-gray-400 hover:text-blue-500 transition-colors p-2 rounded-full hover:bg-blue-50 ${showLogs ? 'text-blue-500 bg-blue-50' : ''}`}
                  title="Toggle Logs"
                >
                  <FiTerminal size={18} />
                </button>
                <button 
                    onClick={() => setMessages([])} 
                    className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50"
                    title="Clear Chat"
                >
                    <FiTrash2 size={18} />
                </button>
              </div>
            </div>

            {/* Content Area with Split View for Logs */}
            <div className="flex-1 overflow-hidden flex relative">
                {/* Messages */}
                <div 
                className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth bg-white/50"
                ref={messagesContainerRef}
                >
                {messages.map((msg) => (
                  (() => {
                    const expandable = isMessageExpandable(msg);
                    const expanded = expandedMessageIds[msg.id] ?? msg.role === 'assistant';
                    const hasStoredProgress = Boolean(msg.progressTrace && (msg.progressTrace.summary || msg.progressTrace.details.length > 0));
                    const progressExpanded = Boolean(expandedProgressMessageIds[msg.id]);
                    return (
                    <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group items-end mb-4`}
                    >
                    {msg.role === 'user' && (
                         <div className="mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button
                                 onClick={() => handleEditMessage(msg)}
                                 className="text-gray-400 hover:text-gray-600 p-1.5 rounded-full hover:bg-gray-100"
                                 title="Edit"
                             >
                                 <FiEdit2 size={14} />
                             </button>
                         </div>
                    )}
                    <div
                        className={`max-w-[85%] lg:max-w-[70%] rounded-2xl px-5 py-3 shadow-sm ${
                        msg.role === 'user'
                            ? 'bg-ri-black text-white'
                            : 'bg-white border border-gray-200 text-gray-800'
                        }`}
                    >
                        {msg.role === 'assistant' && (
                            <div className="flex items-center space-x-2 mb-2 pb-2 border-b border-gray-100 opacity-75">
                                <FiCpu size={14} />
                                <span className="text-xs font-semibold">{selectedAgent.name}</span>
                            </div>
                        )}
                        <div
                          className={`prose ${msg.role === 'user' ? 'prose-invert' : 'prose-sm'} max-w-none ${expandable && !expanded ? 'max-h-56 overflow-hidden' : ''}`}
                        >
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                        >
                            {msg.content}
                        </ReactMarkdown>
                        </div>
                        {msg.role !== 'user' && (
                            <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end items-center gap-2">
                                {hasStoredProgress && (
                                  <button
                                    onClick={() => setExpandedProgressMessageIds(prev => ({ ...prev, [msg.id]: !progressExpanded }))}
                                    className="text-xs text-ri-orange hover:underline inline-flex items-center"
                                    title={progressExpanded ? 'Hide generation progress' : 'Show generation progress'}
                                  >
                                    <FiChevronDown
                                      size={13}
                                      className={`transition-transform ${progressExpanded ? 'rotate-180' : 'rotate-0'}`}
                                    />
                                  </button>
                                )}
                                <button
                                  onClick={() => copyTextWithFeedback(msg.content, `msg-${msg.id}`)}
                                  className="text-xs text-ri-orange hover:underline inline-flex items-center"
                                  title="Copy output"
                                >
                                  {copiedKey === `msg-${msg.id}` ? <FiCheck size={13} /> : <FiCopy size={13} />}
                                </button>
                            </div>
                        )}
                        {expandable && (
                            <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                                <button
                                  onClick={() => setExpandedMessageIds(prev => ({ ...prev, [msg.id]: !expanded }))}
                                  className="text-xs text-ri-orange hover:underline"
                                >
                                  {expanded ? 'Collapse' : 'Expand full output'}
                                </button>
                            </div>
                        )}
                        {hasStoredProgress && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                                {progressExpanded && (
                                  <div className="mt-2 max-h-40 overflow-y-auto rounded border border-gray-100 bg-gray-50 p-2 space-y-1">
                                    <div className="flex justify-end mb-1">
                                      <button
                                        onClick={() => copyTextWithFeedback([
                                          msg.progressTrace?.summary || '',
                                          ...(msg.progressTrace?.details || []),
                                        ].filter(Boolean).join('\n'), `progress-${msg.id}`)}
                                        className="text-xs text-ri-orange hover:underline inline-flex items-center gap-1"
                                      >
                                        {copiedKey === `progress-${msg.id}` ? <FiCheck size={12} /> : <FiCopy size={12} />}
                                        {copiedKey === `progress-${msg.id}` ? 'Copied' : ''}
                                      </button>
                                    </div>
                                    {msg.progressTrace?.summary && (
                                      <div className="text-[11px] text-gray-700 font-medium">
                                        {msg.progressTrace.summary}
                                      </div>
                                    )}
                                    {(msg.progressTrace?.details || []).map((detail, idx) => (
                                      <div key={`${msg.id}-progress-${idx}-${detail.slice(0, 24)}`} className="text-[11px] text-gray-600 font-mono break-all">
                                        {detail}
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </div>
                        )}
                        <div className={`text-[10px] mt-2 text-right opacity-60 ${msg.role === 'user' ? 'text-gray-300' : 'text-gray-400'}`}>
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                    </div>
                    );
                  })()
                ))}
                {(showTypingForCurrentChat || showWelcomeBufferForCurrentChat) && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                          <div className="flex items-center space-x-2">
                              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                              <span className="text-xs text-gray-600">
                                {showWelcomeBufferForCurrentChat ? 'Preparing welcome message...' : (agentProgress || 'Thinking...')}
                              </span>
                          </div>
                          {showTypingForCurrentChat && agentProgressDetails.length > 0 && (
                            <div className="mt-2">
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  onClick={() => setShowAgentProgressDetails(prev => !prev)}
                                  className="text-xs text-ri-orange hover:underline"
                                >
                                  {showAgentProgressDetails ? 'Hide progress details' : 'Show progress details'}
                                </button>
                                <button
                                  onClick={() => copyTextWithFeedback([
                                    agentProgress || '',
                                    ...agentProgressDetails,
                                  ].filter(Boolean).join('\n'), 'live-progress')}
                                  className="text-xs text-ri-orange hover:underline inline-flex items-center gap-1"
                                >
                                  {copiedKey === 'live-progress' ? <FiCheck size={12} /> : <FiCopy size={12} />}
                                  {copiedKey === 'live-progress' ? 'Copied' : ''}
                                </button>
                              </div>
                              {showAgentProgressDetails && (
                                <div className="mt-2 max-h-32 overflow-y-auto rounded border border-gray-100 bg-gray-50 p-2 space-y-1">
                                  {agentProgressDetails.map((detail, idx) => (
                                    <div key={`${idx}-${detail.slice(0, 24)}`} className="text-[11px] text-gray-600 font-mono break-all">
                                      {detail}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                )}
                </div>

                {/* Kernel Logs Panel */}
                {showLogs && (
                    <div className="w-80 bg-gray-900 text-white font-mono text-xs overflow-y-auto p-2 border-l border-gray-700 shadow-xl opacity-95">
                        {(() => {
                          const persistedProgressLines = messages.flatMap((msg) => {
                            if (!msg.progressTrace || (!msg.progressTrace.summary && msg.progressTrace.details.length === 0)) {
                              return [] as string[];
                            }
                            const header = `[progress][message:${msg.id}]`;
                            const summaryLine = msg.progressTrace.summary
                              ? [`${header} summary: ${msg.progressTrace.summary}`]
                              : [];
                            const detailLines = msg.progressTrace.details.map((detail) => `${header} ${detail}`);
                            return [...summaryLine, ...detailLines];
                          });

                          const liveProgressLines = [
                            ...(agentProgress ? [`[progress][live] summary: ${agentProgress}`] : []),
                            ...agentProgressDetails.map((detail) => `[progress][live] ${detail}`),
                          ];

                          const kernelLogLines = kernelExecutionLog.map((log) => `[${log.type}]${log.content}`);
                          const combinedCopyLines = [...kernelLogLines, ...persistedProgressLines, ...liveProgressLines];

                          return (
                            <>
                        <div className="font-bold border-b border-gray-700 pb-2 mb-2 text-gray-400 flex items-center justify-between gap-2">
                            <span>KERNEL LOGS</span>
                            <div className="flex items-center gap-2">
                                <button
                                  onClick={() => copyTextWithFeedback(combinedCopyLines.join('\n'), 'kernel-logs')}
                                  className="text-[11px] text-gray-300 hover:text-white inline-flex items-center gap-1"
                                  title="Copy kernel output"
                                >
                                  {copiedKey === 'kernel-logs' ? <FiCheck size={11} /> : <FiCopy size={11} />}
                                  {copiedKey === 'kernel-logs' ? 'Copied' : 'Copy'}
                                </button>
                                <button
                                  onClick={() => downloadTextReport(combinedCopyLines.join('\n'), 'kernel-debug-report')}
                                  className="text-[11px] text-gray-300 hover:text-white"
                                  title="Download debug report"
                                >
                                  Download
                                </button>
                                <span className={kernelStatus === 'busy' ? 'text-green-400' : 'text-gray-500'}>
                                    {kernelStatus.toUpperCase()}
                                </span>
                            </div>
                        </div>
                        {kernelExecutionLog.map((log, idx) => (
                            <div key={idx} className={`mb-1 break-all ${log.type === 'stderr' ? 'text-red-400' : log.type === 'error' ? 'text-red-500 font-bold' : 'text-gray-300'}`}>
                                <span className="opacity-50 mr-2">[{log.type}]</span>
                            {log.content}
                            </div>
                        ))}
                        {(persistedProgressLines.length > 0 || liveProgressLines.length > 0) && (
                          <>
                            <div className="font-bold border-b border-gray-700 pb-2 mt-3 mb-2 text-gray-400">MESSAGE PROGRESS TRACE</div>
                            {persistedProgressLines.map((line, idx) => (
                              <div key={`persisted-progress-${idx}`} className="mb-1 break-all text-yellow-200">
                                <span className="opacity-50 mr-2">[progress]</span>
                                {line}
                              </div>
                            ))}
                            {liveProgressLines.map((line, idx) => (
                              <div key={`live-progress-${idx}`} className="mb-1 break-all text-green-200">
                                <span className="opacity-50 mr-2">[progress]</span>
                                {line}
                              </div>
                            ))}
                          </>
                        )}
                            </>
                          );
                        })()}
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="bg-white border-t border-gray-200 p-4 relative">
              {/* Optional overlay or tooltip if disabled */}
              {(!isKernelReady || !agentReady) && selectedAgent && (
                  <div className="absolute left-0 right-0 -top-8 flex justify-center pointer-events-none">
                      <span className="bg-white/90 border border-gray-200 shadow-sm text-ri-orange text-xs px-3 py-1 rounded-full flex items-center animate-pulse">
                          <FiZap className="mr-1.5 animate-spin-slow" size={10} />
                          {!isKernelReady ? 'Initializing Python Kernel...' : 'Loading Agent Resources...'}
                      </span>
                  </div>
              )}

              <div className="max-w-4xl mx-auto mb-2 flex items-center justify-between gap-3">
                <label htmlFor="chat-model-select" className="text-xs text-gray-500">
                  Model
                </label>
                <select
                  id="chat-model-select"
                  value={agentChatModel}
                  onChange={(e) => setAgentChatModel(e.target.value)}
                  className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-ri-orange"
                >
                  {CHAT_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`max-w-4xl mx-auto relative flex items-end bg-white border border-gray-300 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-ri-orange focus-within:border-transparent transition-all ${(!isKernelReady || !agentReady) ? 'opacity-60 bg-gray-50' : ''}`}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  disabled={!isKernelReady || !agentReady}
                  placeholder={
                    !isKernelReady 
                    ? "Initializing Python Kernel..." 
                    : !agentReady 
                        ? "Loading Agent Resources..." 
                        : "Type a message..."
                  }
                  className="flex-1 max-h-40 min-h-[50px] w-full bg-transparent border-0 focus:ring-0 focus:outline-none focus-visible:outline-none p-3 resize-none text-gray-800 placeholder-gray-400 disabled:cursor-not-allowed"
                  rows={1}
                />
                
                {isTyping ? (
                    <button
                      onClick={handleCancel}
                      className="mb-2 mr-2 p-2 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 transition-colors"
                      title="Cancel"
                    >
                        <FiStopCircle size={20} />
                    </button>
                ) : (
                    <button
                      onClick={handleSendMessage}
                      disabled={!input.trim() || isTyping || !isKernelReady || !agentReady}
                      className={`mb-2 mr-2 p-2 rounded-lg transition-colors ${
                        input.trim() && !isTyping && isKernelReady && agentReady
                          ? 'bg-ri-orange text-white hover:bg-orange-600'
                          : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      <FiSend size={20} />
                    </button>
                )}
              </div>
              <p className="text-center text-xs text-gray-400 mt-2">
                Running in client-side Python kernel.
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-50 text-center">
             <div className="bg-white p-6 rounded-full shadow-sm mb-4">
                 <FiCpu size={56} className="text-ri-orange" />
             </div>
             <h2 className="text-xl font-bold text-gray-800 mb-2">Select an Agent</h2>
             <p className="text-gray-500 max-w-md">
                 Choose an agent from the sidebar to start a conversation.
             </p>
             {loadingAgents && <p className="mt-4 text-sm text-gray-400">Loading agents...</p>}
          </div>
        )}
      </div>
      <Transition appear show={isShareModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsShareModalOpen(false)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </TransitionChild>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <DialogTitle
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900 flex items-center"
                  >
                    <FiShare2 className="mr-2 text-purple-500" /> Share Session
                  </DialogTitle>
                  <div className="mt-2">
                    <p className="text-sm text-gray-500">
                      Anyone with this link can view the chat history. To share future updates, you'll need to share the link again (or set public visibility permanently).
                    </p>
                    <div className="mt-4 flex items-center space-x-2">
                        <div className="flex-1 bg-gray-100 p-2 rounded text-sm text-gray-600 truncate border border-gray-200">
                            {shareUrl}
                        </div>
                        <button
                            onClick={copyToClipboard}
                            className={`p-2 rounded-md text-white transition-colors ${hasCopied ? 'bg-green-500' : 'bg-purple-500 hover:bg-purple-600'}`}
                            title="Copy Link"
                        >
                            {hasCopied ? <FiCheck size={16} /> : <FiCopy size={16} />}
                        </button>
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end">
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-md border border-transparent bg-purple-100 px-4 py-2 text-sm font-medium text-purple-900 hover:bg-purple-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
                      onClick={() => setIsShareModalOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
      );
    })()
  );
};

export default AgentPage;
