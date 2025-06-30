# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudia is a desktop GUI application for Claude Code built with Tauri 2 (Rust backend) and React 18 (TypeScript frontend). It provides a visual interface for managing Claude Code sessions, creating custom agents, tracking usage, and more.

## Development Commands

### Frontend Development
```bash
# Install dependencies (using Bun package manager)
bun install

# Start frontend dev server only
bun run dev

# Type check TypeScript
bunx tsc --noEmit
```

### Full Application Development
```bash
# Run the full Tauri app in development mode with hot reload
bun run tauri dev

# Build production app with installers
bun run tauri build

# Build without bundling (just executable)
bun run tauri build --no-bundle

# Debug build (faster compilation)
bun run tauri build --debug
```

### Backend/Rust Development
```bash
# Run all Rust tests
cd src-tauri && cargo test

# Run specific test module
cd src-tauri && cargo test sandbox::tests

# Format Rust code
cd src-tauri && cargo fmt

# Check Rust code without building
cd src-tauri && cargo check
```

## Architecture Overview

### Frontend Structure (React + TypeScript)
- **src/components/**: All React components, organized by feature
  - **ui/**: Base shadcn/ui components (Button, Dialog, etc.)
  - Feature components like CCAgents, CCProjects, Timeline, etc.
- **src/lib/**: API client and utilities
  - `api.ts`: Centralized API client for Tauri commands
  - `utils.ts`: Shared utility functions
- **src/assets/**: Styles and static assets

### Backend Structure (Rust + Tauri)
- **src-tauri/src/commands/**: Tauri command handlers exposed to frontend
- **src-tauri/src/sandbox/**: OS-level security sandboxing implementation
  - Platform-specific implementations (Linux seccomp, macOS Seatbelt)
  - Permission profiles and violation tracking
- **src-tauri/src/checkpoint/**: Session versioning and timeline management
- **src-tauri/src/process/**: Process management for Claude Code execution

### Key Technologies
- **UI Framework**: Tailwind CSS v4 with shadcn/ui components
- **State Management**: React hooks and context (no external state library)
- **Build Tool**: Vite 6 with manual chunk splitting for optimization
- **Database**: SQLite for usage tracking and agent storage
- **Markdown Editor**: Monaco-based editor with live preview

## Important Development Patterns

### API Communication
All frontend-backend communication uses Tauri's command system. Commands are defined in `src-tauri/src/commands/` and called via `src/lib/api.ts`.

Example pattern:
```typescript
// Frontend call
const result = await api.executeCommand({ args });

// Backend handler
#[tauri::command]
pub async fn execute_command(args: Args) -> Result<Response, String>
```

### Security Model
- Agents run in sandboxed processes with configurable permissions
- File system access is whitelist-based
- All security violations are logged to SQLite database
- Sandbox profiles can be imported/exported as JSON

### Component Architecture
- All UI components follow shadcn/ui patterns
- Components are feature-based, not page-based
- Shared components go in `components/ui/`
- Use TypeScript strict mode throughout

### Testing Approach
- Rust backend has comprehensive test suite in `src-tauri/tests/`
- Focus on integration tests for sandbox security
- No frontend test framework currently configured

## File Conventions

### TypeScript/React
- Use TypeScript strict mode
- Path alias `@/` maps to `./src/`
- Prefer named exports over default exports
- Follow existing component patterns when creating new ones

### Rust
- Follow standard Rust naming conventions
- Use `anyhow::Result` for error handling
- Async functions use `tokio` runtime
- Serialize/deserialize with `serde`

## Claude Code Integration

The app integrates with Claude Code CLI by:
1. Reading from `~/.claude/projects/` directory
2. Executing `claude` CLI commands via shell
3. Managing Claude Code sessions and checkpoints
4. Parsing and displaying Claude Code output

## Key Features to Understand

### CC Agents
Custom AI agents with:
- System prompts stored in `cc_agents/` as JSON
- Sandboxed execution environment
- Model selection (Opus, Sonnet, Haiku)
- Execution history tracking

### Timeline & Checkpoints
- Creates git-like checkpoints of coding sessions
- Allows branching and forking from any checkpoint
- Stores checkpoint data in SQLite
- Visual timeline navigation in UI

### MCP Server Management
- Manages Model Context Protocol servers
- Can import from Claude Desktop config
- Stores server configs in local database

## Common Tasks

### Adding a New Tauri Command
1. Create handler in `src-tauri/src/commands/`
2. Add `#[tauri::command]` attribute
3. Register in `src-tauri/src/main.rs`
4. Add TypeScript types in `src/lib/api.ts`
5. Call from frontend components

### Creating a New UI Component
1. Check existing patterns in `src/components/`
2. Use shadcn/ui base components when possible
3. Follow TypeScript strict mode
4. Add to relevant feature directory

### Modifying Sandbox Permissions
1. Edit profiles in `src-tauri/src/sandbox/`
2. Update permission enums if adding new types
3. Test with sandbox test suite
4. Update UI components if needed