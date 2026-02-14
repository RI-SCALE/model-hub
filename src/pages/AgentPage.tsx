import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { FiSend, FiCpu, FiTrash2, FiStopCircle, FiZap, FiAlertCircle, FiTerminal } from 'react-icons/fi';
import { useHyphaStore } from '../store/hyphaStore';
import { useKernel } from '../hooks/useKernel';

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
  const { 
    isReady: isKernelReady, 
    startKernel, 
    executeCode, 
    kernelStatus, 
    kernelExecutionLog,
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

  // Initialize kernel if not ready
  useEffect(() => {
    if (!isKernelReady && kernelStatus === 'idle') {
      startKernel();
    }
  }, [isKernelReady, kernelStatus, startKernel]);

  // Load and start agent when selected
  useEffect(() => {
    const loadAgent = async () => {
      // If we don't have what we need, ensure ready state is false
      if (!selectedAgent || !isKernelReady || !executeCode || !server) {
          setAgentReady(false);
          return;
      }
      
      // Start loading
      setAgentReady(false);

      try {
        console.log(`Loading agent ${selectedAgent.name}...`);
        
        // 1. Get the artifact
        const am = await server.getService('public/artifact-manager');
        const artifact = await am.read(selectedAgent.id);
        
        console.log("Agent artifact:", artifact);

        if (!artifact.files) {
            console.warn("Artifact has no files listed. Artifact:", artifact);
        }
        
        const files = artifact.files || [];
        const manifest = artifact.manifest || {};

        // 2. Install dependencies (if any)
        // We look for a requirements.txt file to install extra dependencies
        // Also check manifest for dependencies?
        const reqFile = files.find((f: any) => f.name === 'requirements.txt');
        let packages: string[] = ["hypha-rpc", "openai"]; // Always install hypha-rpc and openai

        if (reqFile) {
            console.log("Installing dependencies from requirements.txt...");
            const reqUrl = await am.get_file(selectedAgent.id, reqFile.name);
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
            const installCode = `
import micropip
import json
try:
    packages = json.loads('${packagesJson}')
    print(f"Installing packages: {packages}")
    await micropip.install(packages)
    print("Dependencies installed successfully.")
except Exception as e:
    print(f"Error installing dependencies: {e}")
            `;
            await executeCode(installCode);
        }

        // 3. Get startup script
        // Strategy:
        // A. check manifest['startup_script'] (can be code string)
        // B. check main.py
        // C. check .ipynb
        
        let scriptContent = "";
        
        if (manifest.startup_script && typeof manifest.startup_script === 'string') {
             console.log("Loading startup script from manifest...");
             scriptContent = manifest.startup_script;
        } else {
            const pyFiles = files.filter((f: any) => f.name.endsWith('.py'));
            const mainFile = pyFiles.find((f: any) => f.name === 'main.py') || pyFiles[0];
            
            const notebookFiles = files.filter((f: any) => f.name.endsWith('.ipynb'));
            const mainNotebook = notebookFiles[0];

            if (mainFile) {
                console.log(`Loading startup script from ${mainFile.name}...`);
                const fileUrl = await am.get_file(selectedAgent.id, mainFile.name);
                const response = await fetch(fileUrl);
                scriptContent = await response.text();
            } else if (mainNotebook) {
                console.log(`Loading startup script from notebook ${mainNotebook.name}...`);
                const fileUrl = await am.get_file(selectedAgent.id, mainNotebook.name);
                const response = await fetch(fileUrl);
                const notebookJson = await response.json();
                
                // Extract code cells
                const codeCells = notebookJson.cells.filter((c: any) => c.cell_type === 'code');
                scriptContent = codeCells.map((c: any) => {
                    const source = Array.isArray(c.source) ? c.source.join('') : c.source;
                    return source;
                }).join('\n\n');
                
                console.log("Extracted code from notebook.");
            } else {
                 throw new Error("No Python startup script found in agent artifact (manifest.startup_script, main.py, or .ipynb).");
            }
        }

        console.log("Startup script content loaded.", scriptContent.substring(0, 100) + "...");

        // 4. Run the script
        await executeCode(scriptContent);
        console.log("Agent startup script executed.");
        
        setAgentReady(true);

        // 5. Connect to the service
        // We'll retry connecting to the service in the chat handler.

        
        // 5. Connect to the service
        // The script typically registers a service.
        // We'll retry connecting to the service in the chat handler.

      } catch (err: any) {
        setAgentReady(false);
        console.error("Error loading agent:", err);
        const errorMsg = {
            id: Date.now().toString(),
            role: 'system' as const,
            content: `**Error loading agent**: ${err.message}`,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    };

    loadAgent();
  }, [selectedAgent, isKernelReady, executeCode, server]);

  
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
        // We need to pass positional arguments correctly to the list function in JS
        // list(parent_id, keywords, filters, limit, offset, order_by, pagination, context)
        // Since we can't easily pass keyword args, we use positional args with undefined for defaults
        const initialAgents = await am.list(
             'hypha-agents/agents', // parent_id
             undefined, // keywords
             undefined, // filters
             100 // limit
        );
        console.log("AgentPage: Agents found:", initialAgents);

        // Filter to only show the specific requested agent
        const targetAgentAlias = 'dotted-acreage-slip-honestly';
        const filteredAgents = initialAgents.filter((agent: any) => 
            agent.alias === targetAgentAlias || 
            agent.id.includes(targetAgentAlias) ||
            // Also matching the "Euro-BioImaging Finder" if user searches for it?
            // The user said "Make this work with dotted-acreage-slip-honestly"
            (agent.alias && agent.alias.includes('leisure-scrimmage'))
        );

        // We assume all found agents are "online" (available to start via proxy)
        const mappedAgents: Agent[] = filteredAgents.map((art: any) => {
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
                    const firstOnline = mappedAgents.find(a => a.status === 'online');
                    return firstOnline || mappedAgents[0];
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

    try {
      
      // Get OpenAI Key from chat-proxy
      let apiKey = "";
      try {
          const proxy = await server.getService("ri-scale/chat-proxy");
          const tokenData = await proxy.get_openai_token();
          apiKey = tokenData.access_token || tokenData.client_secret?.value;
      } catch (e) {
          console.error("Failed to get OpenAI key from proxy:", e);
          // Fallback or error?
      }

      try {
        const pythonResponse = await new Promise<string>(async (resolve, reject) => {
            const code = `
import asyncio
import js
import json
import traceback
import inspect
from openai import AsyncOpenAI

# Helper to send response safely
def send_response(data):
    print(f"__RESPONSE_START__:{json.dumps(data)}")

async def _chat_wrapper():
    try:
        user_msg = json.loads('''${JSON.stringify(newMessage.content).replace(/'''/g, "\\'\\'\\'")}''')
        api_key = "${apiKey}"
        
        if not api_key:
            send_response({"text": "Error: API Key not found. Please ensure chat-proxy is running."})
            return

        client = AsyncOpenAI(api_key=api_key)
        
        # Discover tools
        tools = []
        available_functions = {}
        
        # Basic filtering for user-defined functions
        # We assume functions without underscores are 'public' tools
        for name, func in globals().items():
            if callable(func) and not name.startswith('_') and name not in ['send_response', '_chat_wrapper', 'exit', 'quit', 'get_ipython', 'open', 'print', 'help']:
                # Inspect docstring for description
                doc = inspect.getdoc(func) or "No description provided."
                
                # Inspect signature for parameters
                sig = inspect.signature(func)
                params_schema = {"type": "object", "properties": {}, "required": []}
                
                for param_name, param in sig.parameters.items():
                    param_type = "string" # Default
                    if param.annotation != inspect.Parameter.empty:
                        if param.annotation == int: param_type = "integer"
                        elif param.annotation == float: param_type = "number"
                        elif param.annotation == bool: param_type = "boolean"
                        
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
        
        print(f"Discovered {len(tools)} tools: {[t['function']['name'] for t in tools]}")

        messages = [{"role": "user", "content": user_msg}]
        
        # First call
        response = await client.chat.completions.create(
            model="gpt-4-turbo-preview", # Or gpt-3.5-turbo
            messages=messages,
            tools=tools if tools else None,
            tool_choice="auto" if tools else None
        )
        
        response_message = response.choices[0].message
        tool_calls = response_message.tool_calls
        
        if tool_calls:
            # Append assistant's response (tool call request)
            messages.append(response_message)
            
            for tool_call in tool_calls:
                function_name = tool_call.function.name
                function_to_call = available_functions.get(function_name)
                function_args = json.loads(tool_call.function.arguments)
                
                if function_to_call:
                    print(f"Calling tool: {function_name}({function_args})")
                    try:
                        # Call the function (could be async or sync)
                        if inspect.iscoroutinefunction(function_to_call):
                            function_response = await function_to_call(**function_args)
                        else:
                            function_response = function_to_call(**function_args)
                            
                        messages.append({
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "name": function_name,
                            "content": str(function_response),
                        })
                    except Exception as e:
                        messages.append({
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "name": function_name,
                            "content": f"Error: {str(e)}",
                        })
            
            # Second call to get final response
            second_response = await client.chat.completions.create(
                model="gpt-4-turbo-preview",
                messages=messages
            )
            final_content = second_response.choices[0].message.content
            send_response({"text": final_content})
            
        else:
            send_response({"text": response_message.content})

    except Exception as e:
        traceback.print_exc()
        send_response({"text": f"Error executing chat: {str(e)}"})

asyncio.create_task(_chat_wrapper())
`;
        if (executeCode) {
            await executeCode(code, {
                 onOutput: (log) => {
                    // Try to catch any output that looks like a response, sometimes stdout is split
                    if (log.type === 'stdout') {
                        const content = log.content;
                        if (content.includes('__RESPONSE_START__:')) {
                             const parts = content.split('__RESPONSE_START__:');
                             if (parts.length > 1) {
                                 try {
                                     // Handle potentially multiple lines or broken JSON
                                     let jsonStr = parts[1].trim();
                                     // If we got partial JSON, we might be in trouble, but let's try
                                     const parsed = JSON.parse(jsonStr);
                                     resolve(typeof parsed === 'string' ? parsed : (parsed.text || JSON.stringify(parsed)));
                                 } catch (e) {
                                     // If parsing fails, maybe just return raw string
                                     resolve(parts[1].trim());
                                 }
                             }
                        }
                    }
                 }
             });
        }
             
             // Fallback timeout or if no response parsed?
             // Resolve null?
             setTimeout(() => resolve("No response from agent."), 30000);
        });
        
        const responseText = pythonResponse;

        const responseMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: responseText,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, responseMessage]);

      } catch (err: any) {
          console.error("Local python execution failed:", err);
           const errorResponse: Message = {
            id: Date.now().toString(),
            role: 'system',
            content: `**Error**: ${err.message || 'Unknown error during execution.'}`,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, errorResponse]);
      }

    } catch (e: any) {
         console.error("Error in chat logic:", e);
    }

    } catch (error: any) {
      console.error("Error sending message:", error);
      
      const errorResponse: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `**Error**: ${error.message || 'Unknown error occurred during chat.'}`,
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
                  <div className="flex items-center space-x-2">
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
              </div>
              <div className="flex items-center space-x-2">
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

                {/* Kernel Logs Panel */}
                {showLogs && (
                    <div className="w-80 bg-gray-900 text-white font-mono text-xs overflow-y-auto p-2 border-l border-gray-700 shadow-xl opacity-95">
                        <div className="font-bold border-b border-gray-700 pb-2 mb-2 text-gray-400 flex justify-between">
                            <span>KERNEL LOGS</span>
                            <span className={kernelStatus === 'busy' ? 'text-green-400' : 'text-gray-500'}>
                                {kernelStatus.toUpperCase()}
                            </span>
                        </div>
                        {kernelExecutionLog.map((log, idx) => (
                            <div key={idx} className={`mb-1 break-all ${log.type === 'stderr' ? 'text-red-400' : log.type === 'error' ? 'text-red-500 font-bold' : 'text-gray-300'}`}>
                                <span className="opacity-50 mr-2">[{log.type}]</span>
                                {log.short_content || log.content}
                            </div>
                        ))}
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

              <div className={`max-w-4xl mx-auto relative flex items-end bg-white border border-gray-300 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-ri-orange focus-within:border-transparent transition-all ${(!isKernelReady || !agentReady) ? 'opacity-60 bg-gray-50' : ''}`}>
                <textarea
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
                  className="flex-1 max-h-40 min-h-[50px] w-full bg-transparent border-0 focus:ring-0 p-3 resize-none text-gray-800 placeholder-gray-400 disabled:cursor-not-allowed"
                  rows={1}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || isTyping || !isKernelReady || !agentReady}
                  className={`mb-2 mr-2 p-2 rounded-lg transition-colors ${
                    input.trim() && !isTyping && isKernelReady && agentReady
                      ? 'bg-ri-orange text-white hover:bg-orange-600'
                      : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {isTyping ? <FiStopCircle size={20} /> : <FiSend size={20} />}
                </button>
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
    </div>
  );
};

export default AgentPage;
