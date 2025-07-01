import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  FolderOpen,
  Clock,
  MessageSquare,
  Plus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatUnixTimestamp, truncateText, getFirstLine } from "@/lib/date-utils";
import type { Session, Project, ClaudeMdFile } from "@/lib/api";
import { ClaudeMemoriesDropdown } from "./ClaudeMemoriesDropdown";

interface SessionWithProject extends Session {
  projectPath: string;
  projectId: string;
}

interface SessionListPanelProps {
  /**
   * All sessions organized by project
   */
  sessionsByProject: Map<string, { project: Project; sessions: Session[] }>;
  /**
   * Currently selected session
   */
  selectedSession?: Session | null;
  /**
   * Callback when a session is selected
   */
  onSessionSelect: (session: SessionWithProject) => void;
  /**
   * Callback to create a new session
   */
  onNewSession: (projectPath?: string) => void;
  /**
   * Whether the panel is collapsed
   */
  isCollapsed: boolean;
  /**
   * Callback to toggle collapsed state
   */
  onToggleCollapse: () => void;
  /**
   * Callback when a CLAUDE.md file should be edited
   */
  onEditClaudeFile?: (file: ClaudeMdFile) => void;
  /**
   * Current project path for CLAUDE.md lookup
   */
  currentProjectPath?: string;
  /**
   * Optional className
   */
  className?: string;
}

/**
 * Collapsible session list panel for the chat interface
 */
export const SessionListPanel: React.FC<SessionListPanelProps> = ({
  sessionsByProject,
  selectedSession,
  onSessionSelect,
  onNewSession,
  isCollapsed,
  onToggleCollapse,
  onEditClaudeFile,
  currentProjectPath,
  className
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Auto-expand project containing selected session
  useEffect(() => {
    if (selectedSession) {
      for (const [projectId, data] of sessionsByProject) {
        const hasSession = data.sessions.some(s => s.id === selectedSession.id);
        if (hasSession) {
          setExpandedProjects(prev => new Set([...prev, projectId]));
          break;
        }
      }
    }
  }, [selectedSession, sessionsByProject]);

  // Filter sessions based on search
  const filteredSessionsByProject = new Map<string, { project: Project; sessions: Session[] }>();
  
  for (const [projectId, data] of sessionsByProject) {
    if (!searchQuery) {
      filteredSessionsByProject.set(projectId, data);
    } else {
      const filteredSessions = data.sessions.filter(session => {
        const firstMessage = session.claude_messages?.[0];
        const messageText = firstMessage?.text || "";
        const searchLower = searchQuery.toLowerCase();
        
        return (
          session.id.toLowerCase().includes(searchLower) ||
          messageText.toLowerCase().includes(searchLower) ||
          data.project.path.toLowerCase().includes(searchLower)
        );
      });
      
      if (filteredSessions.length > 0) {
        filteredSessionsByProject.set(projectId, {
          project: data.project,
          sessions: filteredSessions
        });
      }
    }
  }

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  return (
    <div className={cn(
      "h-full bg-background border-r border-border flex flex-col transition-all duration-300",
      isCollapsed ? "w-12" : "w-80",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <AnimatePresence mode="wait">
          {!isCollapsed && (
            <motion.h2
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="text-sm font-semibold"
            >
              Sessions
            </motion.h2>
          )}
        </AnimatePresence>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="h-8 w-8"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col min-h-0"
          >
            {/* Search and New Session */}
            <div className="p-3 space-y-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search sessions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              
              {/* CLAUDE.md Memories */}
              {onEditClaudeFile && currentProjectPath && (
                <ClaudeMemoriesDropdown
                  projectPath={currentProjectPath}
                  onEditFile={onEditClaudeFile}
                />
              )}
              
              <Button
                onClick={() => onNewSession(currentProjectPath)}
                variant="outline"
                size="sm"
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-1" />
                New Session
              </Button>
            </div>

            {/* Session List */}
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-2">
                {Array.from(filteredSessionsByProject).map(([projectId, data]) => {
                  const isExpanded = expandedProjects.has(projectId);
                  const hasSelectedSession = data.sessions.some(s => s.id === selectedSession?.id);
                  
                  return (
                    <div key={projectId} className="space-y-1">
                      {/* Project Header */}
                      <button
                        onClick={() => toggleProject(projectId)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors text-left",
                          hasSelectedSession && "bg-accent/30"
                        )}
                      >
                        <ChevronRight className={cn(
                          "h-3 w-3 transition-transform shrink-0",
                          isExpanded && "rotate-90"
                        )} />
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium truncate flex-1">
                          {data.project.path.split('/').pop() || data.project.path}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {data.sessions.length}
                        </span>
                      </button>

                      {/* Sessions */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="ml-3 space-y-0.5">
                              {data.sessions.map((session) => {
                                const isSelected = selectedSession?.id === session.id;
                                const firstMessage = session.claude_messages?.[0];
                                const messagePreview = firstMessage?.text 
                                  ? getFirstLine(firstMessage.text)
                                  : "New session";
                                
                                return (
                                  <button
                                    key={session.id}
                                    onClick={() => onSessionSelect({
                                      ...session,
                                      projectPath: data.project.path,
                                      projectId: data.project.id
                                    })}
                                    className={cn(
                                      "w-full text-left px-2 py-1.5 rounded-md transition-colors",
                                      "hover:bg-accent/50",
                                      isSelected && "bg-primary/10 hover:bg-primary/20"
                                    )}
                                  >
                                    <div className="flex items-start gap-2">
                                      <MessageSquare className={cn(
                                        "h-3.5 w-3.5 mt-0.5 shrink-0",
                                        isSelected ? "text-primary" : "text-muted-foreground"
                                      )} />
                                      <div className="flex-1 min-w-0">
                                        <div className={cn(
                                          "text-xs truncate",
                                          isSelected ? "font-medium" : ""
                                        )}>
                                          {truncateText(messagePreview, 40)}
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <Clock className="h-3 w-3 text-muted-foreground" />
                                          <span className="text-xs text-muted-foreground">
                                            {formatUnixTimestamp(session.timestamp || session.created_at)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
                
                {filteredSessionsByProject.size === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                      {searchQuery ? "No sessions found" : "No sessions yet"}
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};