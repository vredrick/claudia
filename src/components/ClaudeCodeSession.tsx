import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft,
  Terminal,
  Loader2,
  FolderOpen,
  Copy,
  ChevronDown,
  GitBranch,
  Settings,
  Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover } from "@/components/ui/popover";
import { api, type Session, type Project, type ClaudeMdFile } from "@/lib/api";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { StreamMessage } from "./StreamMessage";
import { FloatingPromptInput, type FloatingPromptInputRef } from "./FloatingPromptInput";
import { ErrorBoundary } from "./ErrorBoundary";
import { TokenCounter } from "./TokenCounter";
import { TimelineNavigator } from "./TimelineNavigator";
import { CheckpointSettings } from "./CheckpointSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SplitPane } from "@/components/ui/split-pane";
import { WebviewPreview } from "./WebviewPreview";
import type { ClaudeStreamMessage } from "./AgentExecution";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SessionListPanel } from "./SessionListPanel";

interface ClaudeCodeSessionProps {
  /**
   * Optional session to resume (when clicking from SessionList)
   */
  session?: Session;
  /**
   * Initial project path (for new sessions)
   */
  initialProjectPath?: string;
  /**
   * All sessions organized by project for the sidebar
   */
  sessionsByProject?: Map<string, { project: Project; sessions: Session[] }>;
  /**
   * Callback to go back
   */
  onBack: () => void;
  /**
   * Callback when a CLAUDE.md file should be edited
   */
  onEditClaudeFile?: (file: ClaudeMdFile) => void;
  /**
   * Optional className for styling
   */
  className?: string;
}

/**
 * ClaudeCodeSession component for interactive Claude Code sessions
 * 
 * @example
 * <ClaudeCodeSession onBack={() => setView('projects')} />
 */
export const ClaudeCodeSession: React.FC<ClaudeCodeSessionProps> = ({
  session,
  initialProjectPath = "",
  sessionsByProject,
  onBack,
  onEditClaudeFile,
  className,
}) => {
  const [projectPath, setProjectPath] = useState(initialProjectPath || session?.project_path || "");
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawJsonlOutput, setRawJsonlOutput] = useState<string[]>([]);
  const [copyPopoverOpen, setCopyPopoverOpen] = useState(false);
  const [isFirstPrompt, setIsFirstPrompt] = useState(!session);
  const [totalTokens, setTotalTokens] = useState(0);
  const [extractedSessionInfo, setExtractedSessionInfo] = useState<{ sessionId: string; projectId: string } | null>(null);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineVersion, setTimelineVersion] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showForkDialog, setShowForkDialog] = useState(false);
  const [forkCheckpointId, setForkCheckpointId] = useState<string | null>(null);
  const [forkSessionName, setForkSessionName] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  
  // State for session panel
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => {
    // Load from localStorage or default to false (expanded)
    const saved = localStorage.getItem('sessionPanelCollapsed');
    return saved ? saved === 'true' : false;
  });
  const [currentSession, setCurrentSession] = useState<Session | undefined>(session);
  
  // New state for preview feature
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [showPreviewPrompt, setShowPreviewPrompt] = useState(false);
  const [splitPosition, setSplitPosition] = useState(50);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  
  const parentRef = useRef<HTMLDivElement>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const hasActiveSessionRef = useRef(false);
  const floatingPromptRef = useRef<FloatingPromptInputRef>(null);

  // Get effective session info (from prop or extracted) - use useMemo to ensure it updates
  const effectiveSession = useMemo(() => {
    if (session) return session;
    if (extractedSessionInfo) {
      return {
        id: extractedSessionInfo.sessionId,
        project_id: extractedSessionInfo.projectId,
        project_path: projectPath,
        created_at: Date.now(),
      } as Session;
    }
    return null;
  }, [session, extractedSessionInfo, projectPath]);

  // Filter out messages that shouldn't be displayed
  const displayableMessages = useMemo(() => {
    return messages.filter((message, index) => {
      // Skip meta messages that don't have meaningful content
      if (message.isMeta && !message.leafUuid && !message.summary) {
        return false;
      }

      // Skip user messages that only contain tool results that are already displayed
      if (message.type === "user" && message.message) {
        if (message.isMeta) return false;

        const msg = message.message;
        if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) {
          return false;
        }

        if (Array.isArray(msg.content)) {
          let hasVisibleContent = false;
          for (const content of msg.content) {
            if (content.type === "text") {
              hasVisibleContent = true;
              break;
            }
            if (content.type === "tool_result") {
              let willBeSkipped = false;
              if (content.tool_use_id) {
                // Look for the matching tool_use in previous assistant messages
                for (let i = index - 1; i >= 0; i--) {
                  const prevMsg = messages[i];
                  if (prevMsg.type === 'assistant' && prevMsg.message?.content && Array.isArray(prevMsg.message.content)) {
                    const toolUse = prevMsg.message.content.find((c: any) => 
                      c.type === 'tool_use' && c.id === content.tool_use_id
                    );
                    if (toolUse) {
                      const toolName = toolUse.name?.toLowerCase();
                      const toolsWithWidgets = [
                        'task', 'edit', 'multiedit', 'todowrite', 'ls', 'read', 
                        'glob', 'bash', 'write', 'grep'
                      ];
                      if (toolsWithWidgets.includes(toolName) || toolUse.name?.startsWith('mcp__')) {
                        willBeSkipped = true;
                      }
                      break;
                    }
                  }
                }
              }
              if (!willBeSkipped) {
                hasVisibleContent = true;
                break;
              }
            }
          }
          if (!hasVisibleContent) {
            return false;
          }
        }
      }
      return true;
    });
  }, [messages]);

  const rowVirtualizer = useVirtualizer({
    count: displayableMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150, // Estimate, will be dynamically measured
    overscan: 5,
  });

  // Debug logging
  useEffect(() => {
    console.log('[ClaudeCodeSession] State update:', {
      projectPath,
      session,
      extractedSessionInfo,
      effectiveSession,
      messagesCount: messages.length,
      isLoading,
      isFirstPrompt,
      claudeSessionId
    });
  }, [projectPath, session, extractedSessionInfo, effectiveSession, messages.length, isLoading, isFirstPrompt, claudeSessionId]);

  // Load session history if resuming
  useEffect(() => {
    if (session) {
      loadSessionHistory();
    }
  }, [session]);
  
  // Update current session when prop changes
  useEffect(() => {
    setCurrentSession(session);
  }, [session]);
  
  // Persist panel collapsed state
  useEffect(() => {
    localStorage.setItem('sessionPanelCollapsed', isPanelCollapsed.toString());
  }, [isPanelCollapsed]);


  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (displayableMessages.length > 0) {
      rowVirtualizer.scrollToIndex(displayableMessages.length - 1, { align: 'end', behavior: 'smooth' });
    }
  }, [displayableMessages.length, rowVirtualizer]);

  // Calculate total tokens from messages
  useEffect(() => {
    const tokens = messages.reduce((total, msg) => {
      if (msg.message?.usage) {
        return total + msg.message.usage.input_tokens + msg.message.usage.output_tokens;
      }
      if (msg.usage) {
        return total + msg.usage.input_tokens + msg.usage.output_tokens;
      }
      return total;
    }, 0);
    setTotalTokens(tokens);
  }, [messages]);

  const loadSessionHistory = async () => {
    if (!session) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const history = await api.loadSessionHistory(session.id, session.project_id);
      
      // Convert history to messages format
      const loadedMessages: ClaudeStreamMessage[] = history.map(entry => ({
        ...entry,
        type: entry.type || "assistant"
      }));
      
      setMessages(loadedMessages);
      setRawJsonlOutput(history.map(h => JSON.stringify(h)));
      
      // After loading history, we're continuing a conversation
      setIsFirstPrompt(false);
    } catch (err) {
      console.error("Failed to load session history:", err);
      setError("Failed to load session history");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSessionSelect = async (sessionWithProject: { projectPath: string; projectId: string } & Session) => {
    // Clear current state
    setMessages([]);
    setRawJsonlOutput([]);
    setError(null);
    setTotalTokens(0);
    setIsFirstPrompt(false);
    
    // Update session info
    setCurrentSession(sessionWithProject);
    setProjectPath(sessionWithProject.projectPath);
    setExtractedSessionInfo({
      sessionId: sessionWithProject.id,
      projectId: sessionWithProject.projectId
    });
    
    // Load the new session history
    try {
      setIsLoading(true);
      const history = await api.loadSessionHistory(sessionWithProject.id, sessionWithProject.projectId);
      
      // Convert history to messages format
      const loadedMessages: ClaudeStreamMessage[] = history.map(entry => ({
        ...entry,
        type: entry.type || "assistant"
      }));
      
      setMessages(loadedMessages);
      setRawJsonlOutput(history.map(h => JSON.stringify(h)));
    } catch (err) {
      console.error("Failed to load session history:", err);
      setError("Failed to load session history");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleNewSession = (newProjectPath?: string) => {
    // Clear all state for new session
    setMessages([]);
    setRawJsonlOutput([]);
    setError(null);
    setTotalTokens(0);
    setIsFirstPrompt(true);
    setCurrentSession(undefined);
    // Set project path if provided, otherwise clear it
    setProjectPath(newProjectPath || "");
    setExtractedSessionInfo(null);
    setClaudeSessionId(null);
  };

  const handleSelectPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Directory"
      });
      
      if (selected) {
        setProjectPath(selected as string);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to select directory:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to select directory: ${errorMessage}`);
    }
  };

  const handleSendPrompt = async (prompt: string, model: "sonnet" | "opus") => {
    console.log('[ClaudeCodeSession] handleSendPrompt called with:', { prompt, model, projectPath });
    
    if (!projectPath) {
      setError("Please select a project directory first");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      hasActiveSessionRef.current = true;
      
      // Clean up previous listeners
      unlistenRefs.current.forEach(unlisten => unlisten());
      unlistenRefs.current = [];
      
      // Set up event listeners before executing
      console.log('[ClaudeCodeSession] Setting up event listeners...');
      
      // Always listen to generic events since the backend emits both generic and session-specific
      // We'll handle session-specific events after we get the session ID
      const eventSuffix = '';
      
      const outputUnlisten = await listen<string>(`claude-output${eventSuffix}`, async (event) => {
        try {
          console.log('[ClaudeCodeSession] Received claude-output:', event.payload);
          
          // Store raw JSONL
          setRawJsonlOutput(prev => [...prev, event.payload]);
          
          // Parse and display
          const message = JSON.parse(event.payload) as ClaudeStreamMessage;
          console.log('[ClaudeCodeSession] Parsed message:', message);
          
          setMessages(prev => {
            console.log('[ClaudeCodeSession] Adding message to state. Previous count:', prev.length);
            return [...prev, message];
          });
          
          // Extract session info from system init message
          if (message.type === "system" && message.subtype === "init" && message.session_id) {
            console.log('[ClaudeCodeSession] Extracting session info from init message:', message.session_id);
            // Extract project ID from the project path
            const projectId = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
            
            // Always update claudeSessionId if we receive a session ID
            setClaudeSessionId(message.session_id);
            
            // Always update extractedSessionInfo to ensure we have the latest session
            setExtractedSessionInfo({
              sessionId: message.session_id,
              projectId: projectId
            });
            
            // After first message with session ID, we're no longer on first prompt
            setIsFirstPrompt(false);
          }
        } catch (err) {
          console.error("Failed to parse message:", err, event.payload);
        }
      });

      const errorUnlisten = await listen<string>(`claude-error${eventSuffix}`, (event) => {
        console.error("Claude error:", event.payload);
        setError(event.payload);
      });

      const completeUnlisten = await listen<boolean>(`claude-complete${eventSuffix}`, async (event) => {
        console.log('[ClaudeCodeSession] Received claude-complete:', event.payload, 'eventSuffix:', eventSuffix);
        console.log('[ClaudeCodeSession] Setting isLoading to false');
        setIsLoading(false);
        hasActiveSessionRef.current = false;
        
        // Check if we should create an auto checkpoint after completion
        if (effectiveSession && event.payload) {
          try {
            const settings = await api.getCheckpointSettings(
              effectiveSession.id,
              effectiveSession.project_id,
              projectPath
            );
            
            if (settings.auto_checkpoint_enabled) {
              await api.checkAutoCheckpoint(
                effectiveSession.id,
                effectiveSession.project_id,
                projectPath,
                prompt
              );
              // Reload timeline to show new checkpoint
              setTimelineVersion((v) => v + 1);
            }
          } catch (err) {
            console.error('Failed to check auto checkpoint:', err);
          }
        }
      });

      unlistenRefs.current = [outputUnlisten, errorUnlisten, completeUnlisten];
      
      // Add the user message immediately to the UI (after setting up listeners)
      const userMessage: ClaudeStreamMessage = {
        type: "user",
        message: {
          content: [
            {
              type: "text",
              text: prompt
            }
          ]
        }
      };
      setMessages(prev => [...prev, userMessage]);

      // Execute the appropriate command
      // Use claudeSessionId if available (it's the actual Claude session ID)
      // Otherwise use effectiveSession.id if resuming an existing session
      const sessionIdToResume = claudeSessionId || effectiveSession?.id;
      
      if (sessionIdToResume && !isFirstPrompt) {
        console.log('[ClaudeCodeSession] Resuming session:', sessionIdToResume);
        await api.resumeClaudeCode(projectPath, sessionIdToResume, prompt, model);
      } else {
        console.log('[ClaudeCodeSession] Starting new session (isFirstPrompt:', isFirstPrompt, ', sessionId:', sessionIdToResume, ')');
        await api.executeClaudeCode(projectPath, prompt, model);
      }
    } catch (err) {
      console.error("Failed to send prompt:", err);
      setError("Failed to send prompt");
      setIsLoading(false);
      hasActiveSessionRef.current = false;
    }
  };

  const handleCopyAsJsonl = async () => {
    const jsonl = rawJsonlOutput.join('\n');
    await navigator.clipboard.writeText(jsonl);
    setCopyPopoverOpen(false);
  };

  const handleCopyAsMarkdown = async () => {
    let markdown = `# Claude Code Session\n\n`;
    markdown += `**Project:** ${projectPath}\n`;
    markdown += `**Date:** ${new Date().toISOString()}\n\n`;
    markdown += `---\n\n`;

    for (const msg of messages) {
      if (msg.type === "system" && msg.subtype === "init") {
        markdown += `## System Initialization\n\n`;
        markdown += `- Session ID: \`${msg.session_id || 'N/A'}\`\n`;
        markdown += `- Model: \`${msg.model || 'default'}\`\n`;
        if (msg.cwd) markdown += `- Working Directory: \`${msg.cwd}\`\n`;
        if (msg.tools?.length) markdown += `- Tools: ${msg.tools.join(', ')}\n`;
        markdown += `\n`;
      } else if (msg.type === "assistant" && msg.message) {
        markdown += `## Assistant\n\n`;
        for (const content of msg.message.content || []) {
          if (content.type === "text") {
            const textContent = typeof content.text === 'string' 
              ? content.text 
              : (content.text?.text || JSON.stringify(content.text || content));
            markdown += `${textContent}\n\n`;
          } else if (content.type === "tool_use") {
            markdown += `### Tool: ${content.name}\n\n`;
            markdown += `\`\`\`json\n${JSON.stringify(content.input, null, 2)}\n\`\`\`\n\n`;
          }
        }
        if (msg.message.usage) {
          markdown += `*Tokens: ${msg.message.usage.input_tokens} in, ${msg.message.usage.output_tokens} out*\n\n`;
        }
      } else if (msg.type === "user" && msg.message) {
        markdown += `## User\n\n`;
        for (const content of msg.message.content || []) {
          if (content.type === "text") {
            const textContent = typeof content.text === 'string' 
              ? content.text 
              : (content.text?.text || JSON.stringify(content.text));
            markdown += `${textContent}\n\n`;
          } else if (content.type === "tool_result") {
            markdown += `### Tool Result\n\n`;
            let contentText = '';
            if (typeof content.content === 'string') {
              contentText = content.content;
            } else if (content.content && typeof content.content === 'object') {
              if (content.content.text) {
                contentText = content.content.text;
              } else if (Array.isArray(content.content)) {
                contentText = content.content
                  .map((c: any) => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
                  .join('\n');
              } else {
                contentText = JSON.stringify(content.content, null, 2);
              }
            }
            markdown += `\`\`\`\n${contentText}\n\`\`\`\n\n`;
          }
        }
      } else if (msg.type === "result") {
        markdown += `## Execution Result\n\n`;
        if (msg.result) {
          markdown += `${msg.result}\n\n`;
        }
        if (msg.error) {
          markdown += `**Error:** ${msg.error}\n\n`;
        }
      }
    }

    await navigator.clipboard.writeText(markdown);
    setCopyPopoverOpen(false);
  };

  const handleCheckpointSelect = async () => {
    // Reload messages from the checkpoint
    await loadSessionHistory();
    // Ensure timeline reloads to highlight current checkpoint
    setTimelineVersion((v) => v + 1);
  };

  const handleCancelExecution = async () => {
    if (!isLoading || isCancelling) return;
    
    try {
      setIsCancelling(true);
      
      // Cancel the Claude execution with session ID if available
      await api.cancelClaudeExecution(claudeSessionId || undefined);
      
      // Clean up listeners
      unlistenRefs.current.forEach(unlisten => unlisten());
      unlistenRefs.current = [];
      
      // Add a system message indicating cancellation
      const cancelMessage: ClaudeStreamMessage = {
        type: "system",
        subtype: "cancelled",
        result: "Execution cancelled by user",
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, cancelMessage]);
      
      // Reset states
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      setError(null);
    } catch (err) {
      console.error("Failed to cancel execution:", err);
      setError("Failed to cancel execution");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleFork = (checkpointId: string) => {
    setForkCheckpointId(checkpointId);
    setForkSessionName(`Fork-${new Date().toISOString().slice(0, 10)}`);
    setShowForkDialog(true);
  };

  const handleConfirmFork = async () => {
    if (!forkCheckpointId || !forkSessionName.trim() || !effectiveSession) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const newSessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await api.forkFromCheckpoint(
        forkCheckpointId,
        effectiveSession.id,
        effectiveSession.project_id,
        projectPath,
        newSessionId,
        forkSessionName
      );
      
      // Open the new forked session
      // You would need to implement navigation to the new session
      console.log("Forked to new session:", newSessionId);
      
      setShowForkDialog(false);
      setForkCheckpointId(null);
      setForkSessionName("");
    } catch (err) {
      console.error("Failed to fork checkpoint:", err);
      setError("Failed to fork checkpoint");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle URL detection from terminal output
  const handleLinkDetected = (url: string) => {
    if (!showPreview && !showPreviewPrompt) {
      setPreviewUrl(url);
      setShowPreviewPrompt(true);
    }
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setIsPreviewMaximized(false);
    // Keep the previewUrl so it can be restored when reopening
  };

  const handlePreviewScreenshot = async (imagePath: string) => {
    console.log("Screenshot captured:", imagePath);
    
    // Add the screenshot to the floating prompt input
    if (floatingPromptRef.current) {
      floatingPromptRef.current.addImage(imagePath);
      
      // Show a subtle animation/feedback that the image was added
      // You could add a toast notification here if desired
    }
  };

  const handlePreviewUrlChange = (url: string) => {
    console.log('[ClaudeCodeSession] Preview URL changed to:', url);
    setPreviewUrl(url);
  };

  const handleTogglePreviewMaximize = () => {
    setIsPreviewMaximized(!isPreviewMaximized);
    // Reset split position when toggling maximize
    if (isPreviewMaximized) {
      setSplitPosition(50);
    }
  };

  // Clean up listeners on component unmount
  useEffect(() => {
    return () => {
      unlistenRefs.current.forEach(unlisten => unlisten());
      // Clear checkpoint manager when session ends
      if (effectiveSession) {
        api.clearCheckpointManager(effectiveSession.id).catch(err => {
          console.error("Failed to clear checkpoint manager:", err);
        });
      }
    };
  }, []);

  const messagesList = (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative px-6"
        style={{
          contain: 'strict',
        }}
      >
        <div
          className="relative w-full py-4"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
          }}
        >
          <AnimatePresence>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const message = displayableMessages[virtualItem.index];
              
              // Determine if we should show the profile icon
              let showProfileIcon = true;
              if (message.type === "assistant" && virtualItem.index > 0) {
                // Look for the previous non-meta message
                let prevIndex = virtualItem.index - 1;
                while (prevIndex >= 0 && displayableMessages[prevIndex].isMeta) {
                  prevIndex--;
                }
                if (prevIndex >= 0) {
                  const prevMessage = displayableMessages[prevIndex];
                  // Only show icon if previous message was from user
                  showProfileIcon = prevMessage.type === "user";
                }
              }
              
              return (
                <motion.div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={(el) => el && rowVirtualizer.measureElement(el)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                  className="absolute left-0 right-0 pb-4"
                  style={{
                    top: virtualItem.start,
                  }}
                >
                  <StreamMessage 
                    message={message} 
                    streamMessages={messages}
                    onLinkDetected={handleLinkDetected}
                    showProfileIcon={showProfileIcon}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Loading and Error indicators positioned relative to the scroll container */}
        <div className="sticky bottom-0 w-full flex flex-col items-center pb-4">
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center py-4 mt-4"
            >
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </motion.div>
          )}
          
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mt-4 w-full max-w-5xl mx-auto"
            >
              {error}
            </motion.div>
          )}
        </div>
      </div>
      
      {/* Floating Prompt Input - Now inside the container */}
      <div className="flex-shrink-0">
        <ErrorBoundary>
          <FloatingPromptInput
            ref={floatingPromptRef}
            onSend={handleSendPrompt}
            onCancel={handleCancelExecution}
            isLoading={isLoading}
            disabled={!projectPath}
            projectPath={projectPath}
            className="relative p-0"
          />
        </ErrorBoundary>
      </div>
    </div>
  );

  const projectPathInput = !session && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="p-4 border-b border-border flex-shrink-0"
    >
      <Label htmlFor="project-path" className="text-sm font-medium">
        Project Directory
      </Label>
      <div className="flex items-center gap-2 mt-1">
        <Input
          id="project-path"
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          placeholder="/path/to/your/project"
          className="flex-1"
          disabled={isLoading}
        />
        <Button
          onClick={handleSelectPath}
          size="icon"
          variant="outline"
          disabled={isLoading}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );

  // If preview is maximized, render only the WebviewPreview in full screen
  if (showPreview && isPreviewMaximized) {
    return (
      <AnimatePresence>
        <motion.div 
          className="fixed inset-0 z-50 bg-background"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <WebviewPreview
            initialUrl={previewUrl}
            onClose={handleClosePreview}
            onScreenshot={handlePreviewScreenshot}
            isMaximized={isPreviewMaximized}
            onToggleMaximize={handleTogglePreviewMaximize}
            onUrlChange={handlePreviewUrlChange}
            className="h-full"
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div className={cn("flex h-full bg-background", className)}>
      {/* Session List Panel */}
      {sessionsByProject && (
        <SessionListPanel
          sessionsByProject={sessionsByProject}
          selectedSession={currentSession}
          onSessionSelect={handleSessionSelect}
          onNewSession={handleNewSession}
          isCollapsed={isPanelCollapsed}
          onToggleCollapse={() => setIsPanelCollapsed(!isPanelCollapsed)}
          onEditClaudeFile={onEditClaudeFile}
          currentProjectPath={projectPath}
        />
      )}
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center justify-between p-4 border-b border-border"
        >
          <div className="flex items-center space-x-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="h-8 w-8"
              disabled={isLoading}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              <div>
                <h2 className="text-lg font-semibold">Claude Code Session</h2>
                <p className="text-xs text-muted-foreground">
                  {session ? `Resuming session ${session.id.slice(0, 8)}...` : 'Interactive session'}
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {effectiveSession && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSettings(!showSettings)}
                  className="flex items-center gap-2"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTimeline(!showTimeline)}
                  className="flex items-center gap-2"
                >
                  <GitBranch className="h-4 w-4" />
                  Timeline
                </Button>
              </>
            )}
            
            {/* Preview Button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!showPreview) {
                        // Open with current URL or empty URL to show the instruction state
                        setShowPreview(true);
                      } else {
                        handleClosePreview();
                      }
                    }}
                    className="flex items-center gap-2"
                  >
                    <Globe className="h-4 w-4" />
                    {showPreview ? "Close Preview" : "Preview"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {showPreview 
                    ? "Close the preview pane" 
                    : "Open a browser preview to test your web applications"
                  }
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            {messages.length > 0 && (
              <Popover
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Output
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                }
                content={
                  <div className="w-44 p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyAsMarkdown}
                      className="w-full justify-start"
                    >
                      Copy as Markdown
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyAsJsonl}
                      className="w-full justify-start"
                    >
                      Copy as JSONL
                    </Button>
                  </div>
                }
                open={copyPopoverOpen}
                onOpenChange={setCopyPopoverOpen}
              />
            )}
            
            <TokenCounter tokens={totalTokens} />
          </div>
        </motion.div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden">
          {showPreview ? (
            // Split pane layout when preview is active
            <SplitPane
              left={
                <div className="h-full flex flex-col overflow-hidden px-3">
                  {projectPathInput}
                  {messagesList}
                </div>
              }
              right={
                <WebviewPreview
                  initialUrl={previewUrl}
                  onClose={handleClosePreview}
                  onScreenshot={handlePreviewScreenshot}
                  isMaximized={isPreviewMaximized}
                  onToggleMaximize={handleTogglePreviewMaximize}
                  onUrlChange={handlePreviewUrlChange}
                />
              }
              initialSplit={splitPosition}
              onSplitChange={setSplitPosition}
              minLeftWidth={400}
              minRightWidth={400}
              className="h-full"
            />
          ) : (
            // Original layout when no preview
            <div className="h-full flex flex-col overflow-hidden">
              <div className="max-w-5xl mx-auto w-full px-6 h-full flex flex-col overflow-hidden">
                {projectPathInput}
                {messagesList}
              </div>
            </div>
          )}

          {isLoading && messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm text-muted-foreground">
                  {session ? "Loading session history..." : "Initializing Claude Code..."}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        {showTimeline && effectiveSession && (
          <TimelineNavigator
            sessionId={effectiveSession.id}
            projectId={effectiveSession.project_id}
            projectPath={projectPath}
            currentMessageIndex={messages.length - 1}
            onCheckpointSelect={handleCheckpointSelect}
            onFork={handleFork}
            refreshVersion={timelineVersion}
          />
        )}
      </div>

      {/* Fork Dialog */}
      <Dialog open={showForkDialog} onOpenChange={setShowForkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fork Session</DialogTitle>
            <DialogDescription>
              Create a new session branch from the selected checkpoint.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fork-name">New Session Name</Label>
              <Input
                id="fork-name"
                placeholder="e.g., Alternative approach"
                value={forkSessionName}
                onChange={(e) => setForkSessionName(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !isLoading) {
                    handleConfirmFork();
                  }
                }}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowForkDialog(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFork}
              disabled={isLoading || !forkSessionName.trim()}
            >
              Create Fork
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      {showSettings && effectiveSession && (
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogContent className="max-w-2xl">
            <CheckpointSettings
              sessionId={effectiveSession.id}
              projectId={effectiveSession.project_id}
              projectPath={projectPath}
              onClose={() => setShowSettings(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
