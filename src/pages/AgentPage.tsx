import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { FiSend, FiCpu, FiTrash2, FiStopCircle, FiZap, FiAlertCircle } from 'react-icons/fi';
import { useHyphaStore } from '../store/hyphaStore';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface Agent {
  id: string; // Artifact ID
  name: string;
  description: string;
  icon?: string;
  status: 'online' | 'offline';
  service_id?: string; // If available
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

const AgentPage: React.FC = () => {
  const { server, isConnected, connect, isConnecting } = useHyphaStore();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  
  const messagesContainerRef = useRef<HTMLDivElement>(null);

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

  // Connect implicitly if not connected
  useEffect(() => {
    if (!isConnected && !isConnecting && !server) {
      console.log("AgentPage: Connecting anonymously to Hypha...");
      connect({ server_url: "https://hypha.aicell.io" }).catch(err => {
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
        // We use the parent_id found: 'hypha-agents/agents'
        const initialAgents = await am.list({
             parent_id: 'hypha-agents/agents',
             limit: 100,
             _rkwargs: true
        });
        console.log("AgentPage: Agents found:", initialAgents);

        // Fetch active services to check status
        let activeServiceIds = new Set<string>();
        try {
            // listServices returns a list of service info objects
            // We fetch all visible services to be safe
            const services = await server.listServices();
            if (Array.isArray(services)) {
                 services.forEach((svc: any) => activeServiceIds.add(svc.id));
            } else {
                 console.warn("Unexpected format for services list:", services);
            }
        } catch (e) {
            console.warn("AgentPage: Failed to list services, assuming offline", e);
        }

        const mappedAgents: Agent[] = initialAgents.map((art: any) => {
          const serviceId = art.alias ? `hypha-agents/${art.alias}` : undefined;
          const isOnline = serviceId && activeServiceIds.has(serviceId);
          
          return {
            id: art.id, // Use full ID for connection
            name: art.manifest?.name || art.alias || 'Unnamed Agent',
            description: art.manifest?.description || 'No description provided.',
            icon: art.manifest?.icon,
            status: isOnline ? 'online' : 'offline',
            service_id: serviceId
          };
        });

        setAgents(mappedAgents);
        if (mappedAgents.length > 0 && !selectedAgent) {
             // Prefer to select an online agent first
             const firstOnline = mappedAgents.find(a => a.status === 'online');
             setSelectedAgent(firstOnline || mappedAgents[0]);
        }
      } catch (err: any) {
        console.error("Error fetching agents:", err);
        setAgentError("Failed to load agents. Please check connection.");
      } finally {
        setLoadingAgents(false);
      }
    };

    if (isConnected && server) {
        fetchAgents();

        // Fetch OpenAI API Key from valid artifacts
        const fetchApiKey = async () => {
          try {
            const am = await server.getService('public/artifact-manager');
            // Try fetching specific secret artifact
            // We assume it returns a JSON with api_key field
            const secretArtifact = await am.read({ artifact_id: 'ri-scale/openai-secret', _rkwargs: true });
            if (secretArtifact?.files) {
               const file = secretArtifact.files.find((f: any) => f.name.endsWith('json') || f.name.endsWith('txt'));
               if (file && file.url) {
                   const r = await fetch(file.url);
                   const data = await r.json();
                   if (data.api_key) {
                       console.log("AgentPage: Loaded API Key from artifact.");
                       setApiKey(data.api_key);
                   }
               }
            }
          } catch (e) {
            console.log("AgentPage: No API key artifact found or access denied (ri-scale/openai-secret).");
          }
        };
        fetchApiKey();
    }
  }, [server, isConnected]);

  // Retrieve chat history when agent changes (optional, omitted for simplicity)
  useEffect(() => {
      if (selectedAgent) {
          setMessages([
              {
                  id: 'welcome-' + selectedAgent.id,
                  role: 'assistant',
                  content: `Hello! I am **${selectedAgent.name}**. How can I assist you?`,
                  timestamp: new Date()
              }
          ]);
      }
  }, [selectedAgent]);


  const handleSendMessage = async () => {
    if (!input.trim() || !selectedAgent || !server) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    setInput('');
    setIsTyping(true);

    try {
      // Attempt to connect to the agent service and chat
      // This logic assumes the agent exposes a 'chat' or 'run' method
      // Or we should assume a generic agent-runner interface if specific service fails.
      
      let agentService;
      let serviceAvailable = false;
      
      try {
           // Try specific service first: hypha-agents/alias
           const serviceId = selectedAgent.service_id || selectedAgent.id;
           agentService = await server.getService(serviceId);
           serviceAvailable = true;
      } catch (e) {
          console.warn(`Specific service ${selectedAgent.service_id} not found: ${e}`);
      }
      
      if (!serviceAvailable) {
          // If specific service fails (because it's not a persistent service),
          // Check if it's a "serverless" agent that needs to be invoked via artifact runner?
          // Or mock it for now if "real" execution is too complex without hypha-agent lib.
          
          throw new Error("Agent is not currently running as a service. Please start the agent or use an active one.");
      }
      
      // If we have a service, call chat
      const response = await agentService.chat({
          text: newMessage.content,
          history: [], // Simplify history for now
          context: apiKey ? { openai_api_key: apiKey } : undefined
      });

      const responseText = typeof response === 'string' ? response : (response.text || JSON.stringify(response));

      const responseMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, responseMessage]);

    } catch (error: any) {
      console.error("Error sending message:", error);
      
      const errorResponse: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `**Error**: ${error.message || 'Unknown error occurred during chat.'}\n\n*Note: To chat with this agent, ensure the corresponding service is running on Hypha.*`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorResponse]);
    } finally {
        setIsTyping(false);
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
    <div className="flex h-[calc(100vh-80px)] bg-gray-50">
      {/* Sidebar - Agent Selection */}
      <div className="w-80 bg-white border-r border-gray-200 hidden md:flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center">
                <FiZap className="mr-2 text-ri-orange" size={20} />
                <h2 className="font-semibold text-lg text-gray-800">Agents</h2>
            </div>
            {loadingAgents && <span className="text-xs text-gray-400">Loading...</span>}
        </div>
        
        {agentError && (
            <div className="p-4 bg-red-50 text-red-600 text-sm flex items-center">
                <FiAlertCircle className="mr-2" />
                {agentError}
            </div>
        )}

        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(agent)}
              className={`w-full text-left p-3 rounded-lg border transition-all duration-200 flex items-start space-x-3 
                ${selectedAgent?.id === agent.id 
                  ? 'border-ri-orange bg-orange-50 ring-1 ring-ri-orange' 
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              <div className={`mt-1 p-2 rounded-full ${selectedAgent?.id === agent.id ? 'bg-orange-100 text-ri-orange' : 'bg-gray-100 text-gray-500'}`}>
                {agent.icon ? <img src={agent.icon} alt="" className="w-4 h-4 object-cover rounded-full" /> : <FiCpu size={18} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between pointer-events-none">
                    <p className="font-medium text-gray-900 truncate">{agent.name}</p>
                    <span className={`h-2 w-2 rounded-full ${agent.status==='online'?'bg-green-500':'bg-red-500'}`} title={agent.status} />
                </div>
                <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">{agent.description}</p>
              </div>
            </button>
          ))}
          {!loadingAgents && agents.length === 0 && !agentError && (
              <div className="text-center p-4 text-gray-500 text-sm">
                  No agents found.
              </div>
          )}
        </div>
        
        <div className="p-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 text-center">
            Powered by Hypha
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {selectedAgent ? (
          <>
            {/* Header */}
            <div className="bg-white px-6 py-3 border-b border-gray-200 flex items-center justify-between shadow-sm z-10">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-orange-100 rounded-full text-ri-orange">
                    {selectedAgent.icon ? <img src={selectedAgent.icon} alt="" className="w-5 h-5 object-cover rounded-full" /> : <FiCpu size={20} />}
                </div>
                <div>
                  <h3 className="font-bold text-gray-800">{selectedAgent.name}</h3>
                  <p className={`text-xs flex items-center ${selectedAgent.status === 'online' ? 'text-green-600' : 'text-red-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${selectedAgent.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    {' '}
                    {selectedAgent.status === 'online' ? 'Online' : 'Offline'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setMessages([])} 
                className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50"
                title="Clear Chat"
              >
                <FiTrash2 size={18} />
              </button>
            </div>

            {/* Messages */}
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth bg-white/50"
              ref={messagesContainerRef}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
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
                    <div className={`prose ${msg.role === 'user' ? 'prose-invert' : 'prose-sm'} max-w-none`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    <div className={`text-[10px] mt-2 text-right opacity-60 ${msg.role === 'user' ? 'text-gray-300' : 'text-gray-400'}`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm flex items-center space-x-2">
                     <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                     <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                     <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="bg-white border-t border-gray-200 p-4">
              <div className="max-w-4xl mx-auto relative flex items-end bg-white border border-gray-300 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-ri-orange focus-within:border-transparent transition-all">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Type a message..."
                  className="flex-1 max-h-40 min-h-[50px] w-full bg-transparent border-0 focus:ring-0 p-3 resize-none text-gray-800 placeholder-gray-400"
                  rows={1}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || isTyping}
                  className={`mb-2 mr-2 p-2 rounded-lg transition-colors ${
                    input.trim() && !isTyping
                      ? 'bg-ri-orange text-white hover:bg-orange-600'
                      : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {isTyping ? <FiStopCircle size={20} /> : <FiSend size={20} />}
                </button>
              </div>
              <p className="text-center text-xs text-gray-400 mt-2">
                AI agents can make mistakes. Please verify important information.
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
    </div>
  );
};

export default AgentPage;
