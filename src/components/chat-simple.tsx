'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { ChatMessages } from '@/components/chat-messages';
import { TextareaWithActions } from '@/components/textarea-with-actions';
import { ChatSessions } from '@/components/chat-sessions';
import { Button, styles } from '@/components/button';
import { USER_NAME, CHAT_SOURCE } from '@/constants';
import SocketIOManager, { ControlMessageData, MessageBroadcastData } from '@/lib/socketio-manager';
import type { ChatMessage } from '@/types/chat-message';
import { getChannelMessages, getRoomMemories, pingServer } from '@/lib/api-client';

// Simple spinner component
const LoadingSpinner = () => (
  <svg
    className="animate-spin h-4 w-4 text-zinc-600 dark:text-zinc-400"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

interface ChatProps {
  sessionId?: string;
}

export const Chat = ({ sessionId: propSessionId }: ChatProps = {}) => {
  const router = useRouter();

  // --- Environment Configuration ---
  const agentId = process.env.NEXT_PUBLIC_AGENT_ID;
  const serverId = '00000000-0000-0000-0000-000000000000'; // Default server ID from ElizaOS

  // --- User Entity ---
  const [userEntity, setUserEntity] = useState<string | null>(null);

  // Helper function to get user entity from localStorage
  const getUserEntity = (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('elizaHowUserEntity');
  };

  // --- State ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [inputDisabled, setInputDisabled] = useState<boolean>(false);
  const [sessionId, setSessionId] = useState<string | null>(propSessionId || null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [isAgentThinking, setIsAgentThinking] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting'
  );
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [agentStatus, setAgentStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [showSessionSwitcher, setShowSessionSwitcher] = useState<boolean>(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState<boolean>(false);

  // --- Refs ---
  const initStartedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketIOManager = SocketIOManager.getInstance();

  // Format time ago utility
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Initialize user entity on client side only to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedEntity = localStorage.getItem('elizaHowUserEntity');
      if (storedEntity) {
        setUserEntity(storedEntity);
      } else {
        const newEntity = uuidv4();
        localStorage.setItem('elizaHowUserEntity', newEntity);
        setUserEntity(newEntity);
      }
    }
  }, []);

  // --- Check Server Status ---
  useEffect(() => {
    if (!agentId) return; // Guard against missing config

    const checkServer = async () => {
      try {
        console.log('[Chat] Checking server status...');
        const isOnline = await pingServer();
        console.log('[Chat] Server ping result:', isOnline);
        setServerStatus(isOnline ? 'online' : 'offline');
        if (!isOnline) {
          setConnectionStatus('error');
        }
      } catch (error) {
        console.error('[Chat] Server check failed:', error);
        setServerStatus('offline');
        setConnectionStatus('error');
      }
    };

    checkServer();
  }, [agentId]);

  // Function to create a new chat session
  const createNewSession = async (initialMessage?: string) => {
    const currentUserEntity = getUserEntity(); // Read from localStorage directly

    if (!currentUserEntity || !agentId) {
      console.error('[Chat] Cannot create session - missing userEntity or agentId');
      return null;
    }

    try {
      console.log(`[Chat] Creating new session with initial message: "${initialMessage}"`);
      console.log(`[Chat] Using user entity: ${currentUserEntity}`);

      const response = await fetch('/api/chat-session/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: currentUserEntity,
          initialMessage: initialMessage,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const result = await response.json();
      const newSessionId = result.data.sessionId;
      const newChannelId = result.data.channelId;

      console.log(`[Chat] Created new session: ${newSessionId} with channel: ${newChannelId}`);

      // Navigate to the new session
      router.push(`/chat/${newSessionId}`);

      return { sessionId: newSessionId, channelId: newChannelId };
    } catch (error) {
      console.error('[Chat] Failed to create new session:', error);
      return null;
    }
  };

  // --- Load Session Data ---
  useEffect(() => {
    const currentUserEntity = getUserEntity(); // Read from localStorage directly

    if (!sessionId || !currentUserEntity || !agentId) return;

    // Reset session state for new session
    initStartedRef.current = false;
    setMessages([]);
    setIsLoadingHistory(true);
    setIsAgentThinking(false);

    const loadSession = async () => {
      try {
        console.log(`[Chat] Loading session: ${sessionId}`);

        const response = await fetch(
          `/api/chat-session/${sessionId}?userId=${encodeURIComponent(currentUserEntity)}`
        );

        if (!response.ok) {
          if (response.status === 404) {
            console.error(`[Chat] Session ${sessionId} not found`);
            // Redirect to home page for invalid sessions
            router.push('/');
            return;
          }
          throw new Error('Failed to load session');
        }

        const result = await response.json();
        const session = result.data;

        setSessionData(session);
        setChannelId(session.channelId);

        console.log(`[Chat] Loaded session: ${session.title} (${session.messageCount} messages)`);
      } catch (error) {
        console.error('[Chat] Failed to load session:', error);
        setIsLoadingHistory(false);
      }
    };

    loadSession();
  }, [sessionId, agentId, router]);

  // --- Initialize Socket Connection ---
  useEffect(() => {
    const currentUserEntity = getUserEntity(); // Read from localStorage directly

    if (!currentUserEntity || !agentId || serverStatus !== 'online') {
      return;
    }

    const initializeConnection = async () => {
      console.log('[Chat] Initializing connection...');
      setConnectionStatus('connecting');

      try {
        // Step 1: Add agent to centralized channel
        const centralChannelId = '00000000-0000-0000-0000-000000000000';

        console.log('[Chat] Adding agent to centralized channel...');
        setAgentStatus('checking');

        try {
          const addAgentResponse = await fetch(
            `/api/eliza/messaging/central-channels/${centralChannelId}/agents`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                agentId: agentId,
              }),
            }
          );

          if (addAgentResponse.ok) {
            console.log('[Chat] ✅ Agent successfully added to centralized channel');
            setAgentStatus('ready');
          } else {
            const errorText = await addAgentResponse.text();
            console.warn('[Chat] ⚠️ Failed to add agent to channel:', errorText);
            // Agent might already be in channel, treat as success
            setAgentStatus('ready');
          }
        } catch (error) {
          console.warn('[Chat] ⚠️ Error adding agent to channel:', error);
          // Continue anyway but mark as potential issue
          setAgentStatus('error');
        }

        // Step 2: Initialize socket connection
        console.log('[Chat] Initializing socket connection...');
        socketIOManager.initialize(currentUserEntity, serverId);

        // Step 3: Check connection status
        const checkConnection = () => {
          if (socketIOManager.isSocketConnected()) {
            console.log('[Chat] ✅ Socket connected successfully');
            setConnectionStatus('connected');
          } else {
            setTimeout(checkConnection, 1000); // Check again in 1 second
          }
        };

        checkConnection();
      } catch (error) {
        console.error('[Chat] ❌ Failed to initialize connection:', error);
        setConnectionStatus('error');
      }
    };

    initializeConnection();
  }, [agentId, serverStatus, socketIOManager]);

  // --- Set up Socket Event Listeners ---
  useEffect(() => {
    const currentUserEntity = getUserEntity(); // Read from localStorage directly

    if (connectionStatus !== 'connected' || !channelId || !sessionId) {
      return;
    }

    console.log('[Chat] Setting up socket event listeners...');

    // Message broadcast handler
    const handleMessageBroadcast = (data: MessageBroadcastData) => {
      console.log('[Chat] Received message broadcast:', data);

      // Skip our own messages to avoid duplicates
      if (data.senderId === currentUserEntity) {
        console.log('[Chat] Skipping our own message broadcast');
        return;
      }

      // Check if this is an agent message by sender ID
      const isAgentMessage = data.senderId === agentId;

      const message: ChatMessage = {
        id: data.id || uuidv4(),
        name: data.senderName || (isAgentMessage ? 'Agent' : 'User'),
        text: data.text,
        senderId: data.senderId,
        roomId: data.roomId || data.channelId || channelId,
        createdAt: data.createdAt || Date.now(),
        source: data.source,
        thought: data.thought,
        actions: data.actions,
        papers: data.papers,
        isLoading: false,
      };

      console.log('[Chat] Adding message:', { isAgentMessage, message });

      // If this is an agent message, simulate streaming by adding character by character
      if (isAgentMessage && message.text) {
        // Add the message with empty text first
        const streamingMessage = { ...message, text: '' };
        setMessages((prev) => [...prev, streamingMessage]);

        setIsAgentThinking(false);
        setInputDisabled(false);

        // Stream the text character by character
        const fullText = message.text;
        let currentIndex = 0;

        const streamInterval = setInterval(() => {
          if (currentIndex < fullText.length) {
            setMessages((prev) => {
              const newMessages = [...prev];
              const messageIndex = newMessages.findIndex((msg) => msg.id === message.id);
              if (messageIndex !== -1) {
                newMessages[messageIndex] = {
                  ...newMessages[messageIndex],
                  text: fullText.slice(0, currentIndex + 1),
                };
              }
              return newMessages;
            });
            currentIndex++;

            // Scroll to bottom during streaming
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          } else {
            clearInterval(streamInterval);
          }
        }, 10); // Adjust speed: lower = faster, higher = slower
      } else {
        // For non-agent messages, add normally
        setMessages((prev) => [...prev, message]);
      }
    };

    // Control message handler
    const handleControlMessage = (data: ControlMessageData) => {
      console.log('[Chat] Received control message:', data);

      if (data.action === 'disable_input') {
        setInputDisabled(true);
      } else if (data.action === 'enable_input') {
        setInputDisabled(false);
      }
    };

    // Message complete handler
    const handleMessageComplete = () => {
      console.log('[Chat] Message complete');
      setIsAgentThinking(false);
      setInputDisabled(false);
    };

    // Attach event listeners
    socketIOManager.on('messageBroadcast', handleMessageBroadcast);
    socketIOManager.on('controlMessage', handleControlMessage);
    socketIOManager.on('messageComplete', handleMessageComplete);

    // Join the session channel
    socketIOManager.joinChannel(channelId, serverId);

    // Set the active session channel ID for message filtering
    socketIOManager.setActiveSessionChannelId(channelId);
    console.log('[Chat] Set active session channel ID:', channelId);

    // For DM sessions, we don't need to join the central channel
    // The agent should respond directly to the session channel

    // Cleanup function
    return () => {
      socketIOManager.off('messageBroadcast', handleMessageBroadcast);
      socketIOManager.off('controlMessage', handleControlMessage);
      socketIOManager.off('messageComplete', handleMessageComplete);
      socketIOManager.leaveChannel(channelId);
      socketIOManager.clearActiveSessionChannelId();
    };
  }, [connectionStatus, channelId, agentId, socketIOManager]);

  const sendMessageRef = useRef<(messageText: string) => void>(() => {});

  // --- Send Message Logic ---
  // This useEffect updates the ref on every render to hold the latest version of the sendMessage function,
  // with access to the latest state (channelId, inputDisabled, etc.).
  useEffect(() => {
    sendMessageRef.current = (messageText: string) => {
      const currentUserEntity = getUserEntity(); // Read from localStorage directly

      // This check now uses the most current state from the render it was created in.
      if (
        !messageText.trim() ||
        !currentUserEntity ||
        !channelId ||
        inputDisabled ||
        connectionStatus !== 'connected'
      ) {
        console.warn('[Chat] Cannot send message (stale state prevented):', {
          hasText: !!messageText.trim(),
          hasUserEntity: !!currentUserEntity,
          hasChannelId: !!channelId,
          inputDisabled,
          connectionStatus,
        });
        return;
      }

      // Add deep research suffix if enabled
      const finalMessageText = deepResearchEnabled 
        ? `${messageText.trim()} Use FutureHouse to answer.`
        : messageText.trim();

      const userMessage: ChatMessage = {
        id: uuidv4(),
        name: USER_NAME,
        text: finalMessageText,
        senderId: currentUserEntity,
        roomId: channelId,
        createdAt: Date.now(),
        source: CHAT_SOURCE,
        isLoading: false,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsAgentThinking(true);
      setInputDisabled(true);

      console.log('[Chat] Sending message to session channel:', {
        messageText: finalMessageText,
        channelId,
        source: CHAT_SOURCE,
        deepResearch: deepResearchEnabled,
      });

      socketIOManager.sendChannelMessage(finalMessageText, channelId, CHAT_SOURCE);

      setTimeout(() => {
        console.log('[Chat] Timeout reached, re-enabling input');
        setInputDisabled(false);
        setIsAgentThinking(false);
      }, 60000);
    };
  }); // No dependency array, so it updates on every render

  // This is a stable function that we can pass as a prop. It never changes.
  // It acts as a "portal" to call the most up-to-date logic from our ref.
  const sendMessage = useCallback((messageText: string) => {
    sendMessageRef.current?.(messageText);
  }, []); // Empty dependency array ensures this function is created only ONCE.

  // --- Load Message History and Send Initial Query ---
  useEffect(() => {
    const currentUserEntity = getUserEntity(); // Read from localStorage directly

    if (
      !channelId ||
      !agentId ||
      !currentUserEntity ||
      connectionStatus !== 'connected' ||
      initStartedRef.current
    ) {
      return;
    }

    initStartedRef.current = true;
    setIsLoadingHistory(true);

    console.log(`[Chat] Loading message history for channel: ${channelId}`);

    // Load message history - try channel messages first, fallback to room memories
    const loadMessageHistory = async () => {
      try {
        // First try the channel messages API (matches new message format)
        const channelMessages = await getChannelMessages(channelId, 50);
        if (channelMessages.length > 0) {
          console.log(`[Chat] Loaded ${channelMessages.length} channel messages`);
          return channelMessages;
        }

        // Fallback to room memories if channel messages are empty
        console.log('[Chat] No channel messages found, trying room memories...');
        const roomMessages = await getRoomMemories(agentId, channelId, 50);
        console.log(`[Chat] Loaded ${roomMessages.length} room memory messages`);
        return roomMessages;
      } catch (error) {
        console.error('[Chat] Error loading message history:', error);
        return [];
      }
    };

    loadMessageHistory()
      .then((loadedMessages) => {
        console.log(`[Chat] Loaded ${loadedMessages.length} messages from history`);
        setMessages(loadedMessages);

        // If there's an initial message from session creation and no existing messages, send it
        if (sessionData?.metadata?.initialMessage && loadedMessages.length === 0) {
          console.log(
            `[Chat] New session detected - sending initial message: ${sessionData.metadata.initialMessage}`
          );
          setTimeout(() => {
            sendMessage(sessionData.metadata.initialMessage);
          }, 500); // Small delay to ensure everything is ready
        }
      })
      .catch((error) => {
        console.error('[Chat] Failed to load message history:', error);

        // Even if history loading fails, send initial message if present
        if (sessionData?.metadata?.initialMessage) {
          console.log(
            `[Chat] Sending initial message despite history loading failure: ${sessionData.metadata.initialMessage}`
          );
          setTimeout(() => {
            sendMessage(sessionData.metadata.initialMessage);
          }, 1000);
        }
      })
      .finally(() => {
        setIsLoadingHistory(false);
      });
  }, [channelId, agentId, connectionStatus, sessionData, sendMessage]);

  // Scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Handle Form Submit ---
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim()) {
        sendMessage(input.trim());
        setInput('');
      }
    },
    [input, sendMessage]
  );

  // --- Handle Speech-to-Text ---
  const handleTranscript = useCallback(
    (transcribedText: string) => {
      console.log('[Chat] Received transcript:', transcribedText);

      if (transcribedText.trim()) {
        sendMessage(transcribedText.trim());
        setInput(''); // Clear the input field after sending
      }
    },
    [sendMessage]
  );

  // --- Handle Deep Research Toggle ---
  const handleDeepResearchToggle = useCallback(() => {
    setDeepResearchEnabled(prev => !prev);
  }, []);

  // --- Render Connection Status ---
  const renderConnectionStatus = () => {
    if (serverStatus === 'checking') {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <LoadingSpinner />
          Checking server connection...
        </div>
      );
    }

    if (serverStatus === 'offline') {
      return (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 shadow-sm">
          <div>
            <h3 className="text-red-800 dark:text-red-200 font-semibold text-sm">
              Connection Failed
            </h3>
            <p className="text-red-700 dark:text-red-300 text-sm mt-1 leading-relaxed">
              Unable to establish connection to ElizaOS server at{' '}
              <code className="bg-red-100 dark:bg-red-800/50 px-1.5 py-0.5 rounded text-xs font-mono">
                {process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'}
              </code>
            </p>
            <p className="text-red-600 dark:text-red-400 text-xs mt-2">
              Please ensure the server is running and accessible.
            </p>
          </div>
        </div>
      );
    }

    if (connectionStatus === 'connecting') {
      const statusText =
        agentStatus === 'checking'
          ? 'Setting up agent participation...'
          : agentStatus === 'ready'
            ? 'Connecting to agent...'
            : 'Connecting (agent setup failed)...';

      return (
        <div className="flex items-center gap-2 text-sm text-blue-600 mb-4">
          <LoadingSpinner />
          {statusText}
        </div>
      );
    }

    if (connectionStatus === 'error') {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span className="text-red-700 font-medium">Connection Error</span>
          </div>
          <p className="text-red-600 text-sm mt-1">
            Failed to connect to the agent. Please try refreshing the page.
          </p>
        </div>
      );
    }

    if (connectionStatus === 'connected') {
      return (
        <div className="flex items-center gap-2 text-sm text-green-600 mb-4">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          Connected to Agent
        </div>
      );
    }

    return null;
  };

  // Check if environment is properly configured
  if (!agentId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-6">
          <h2 className="text-xl font-semibold mb-2">Configuration Error</h2>
          <p className="text-gray-600 mb-4">
            NEXT_PUBLIC_AGENT_ID is not configured in environment variables.
          </p>
          <p className="text-sm text-gray-500">
            Please check your .env file and ensure NEXT_PUBLIC_AGENT_ID is set.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full max-w-4xl mx-auto flex flex-col">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0 px-4 pt-20 pb-4 bg-white dark:bg-black border-b border-zinc-950/10 dark:border-white/10">
        <div className="hidden lg:block mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex-1">
              <h1 className="text-2xl font-bold">
                {sessionData?.title || 'Chat with ElizaOS Agent'}
              </h1>
              {sessionData && (
                <div className="text-zinc-600 dark:text-zinc-400 text-sm mt-1">
                  {sessionData.messageCount} messages • Last activity{' '}
                  {formatTimeAgo(sessionData.lastActivity)}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => createNewSession()} color="blue">
                New Chat
              </Button>
              {sessionData && (
                <Button onClick={() => setShowSessionSwitcher(!showSessionSwitcher)} plain>
                  {showSessionSwitcher ? 'Hide Sessions' : 'Switch Chat'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Connection Status */}
        <div className="mb-4">{renderConnectionStatus()}</div>

        {/* Session Switcher */}
        {showSessionSwitcher && userEntity && (
          <div className="hidden lg:block mb-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 border border-zinc-950/10 dark:border-white/10">
            <ChatSessions userId={userEntity} currentSessionId={sessionId} showSwitcher={true} />
          </div>
        )}
      </div>

      {/* Scrollable Chat Messages */}
      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {/* Only show history loading if we're connected and actually loading history */}
        {connectionStatus === 'connected' && isLoadingHistory ? (
          <div className="flex items-center justify-center h-32">
            <div className="flex items-center gap-2">
              <LoadingSpinner />
              <span className="text-gray-600">Loading conversation history...</span>
            </div>
          </div>
        ) : (
          <>
            <ChatMessages
              messages={messages}
              followUpPromptsMap={{}}
              onFollowUpClick={(prompt) => {
                // Handle follow-up prompts by setting as new input
                setInput(prompt);
              }}
            />
            {isAgentThinking && (
              <div className="flex items-center gap-2 py-4 text-gray-600">
                <LoadingSpinner />
                <span>
                  {process.env.NEXT_PUBLIC_AGENT_NAME || 'Agent'} is fetching science knowledge...
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area - Fixed at Bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white dark:bg-black z-10">
        <div className="w-full max-w-4xl mx-auto">
          <TextareaWithActions
            input={input}
            onInputChange={(e) => setInput(e.target.value)}
            onSubmit={handleSubmit}
            isLoading={isAgentThinking || inputDisabled || connectionStatus !== 'connected'}
            placeholder={
              connectionStatus === 'connected' ? 'Type your message...' : 'Connecting...'
            }
            onTranscript={handleTranscript}
            deepResearchEnabled={deepResearchEnabled}
            onDeepResearchToggle={handleDeepResearchToggle}
          />
        </div>
      </div>

      {/* Debug Info (Only when NEXT_PUBLIC_DEBUG is enabled) */}
      {process.env.NEXT_PUBLIC_DEBUG === 'true' && (
        <div className="mt-4 p-2 bg-gray-100 rounded text-xs text-gray-600">
          <div>Agent ID: {agentId}</div>
          <div>Session ID: {sessionId}</div>
          <div>Channel ID: {channelId}</div>
          <div>User Entity: {userEntity}</div>
          <div>User Entity (localStorage): {getUserEntity()}</div>
          <div>Connection: {connectionStatus}</div>
          <div>Server: {serverStatus}</div>
          <div>Agent Status: {agentStatus}</div>
          <div>Input Disabled: {inputDisabled ? 'true' : 'false'}</div>
          <div>Agent Thinking: {isAgentThinking ? 'true' : 'false'}</div>
        </div>
      )}
    </div>
  );
};

export default Chat;
