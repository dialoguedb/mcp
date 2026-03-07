# dialogue-db-mcp

MCP (Model Context Protocol) server for [DialogueDB](https://dialoguedb.com) - persist, search, and resume AI conversations across devices.

## Features

- **Save Sessions** - Persist your AI agent conversations to the cloud
- **Resume Anywhere** - Continue conversations from any device
- **Search History** - Find relevant past conversations by content
- **Threading** - Create branching conversations for exploring alternatives
- **State Management** - Persist conversation context and preferences

## Installation

### With Goose

```bash
goose configure
# → Add Extension
# → npm package
# → dialogue-db-mcp
```

Or add to your Goose config directly:

```yaml
# ~/.config/goose/config.yaml
extensions:
  dialoguedb:
    type: stdio
    cmd: npx
    args: ["dialogue-db-mcp"]
    env:
      DIALOGUEDB_API_KEY: "your-api-key"
```

### With Claude Desktop

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "dialoguedb": {
      "command": "npx",
      "args": ["dialogue-db-mcp"],
      "env": {
        "DIALOGUEDB_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Standalone

```bash
npm install -g dialogue-db-mcp

# Run directly
DIALOGUEDB_API_KEY=your-key dialoguedb-mcp
```

## Available Tools

### `dialoguedb_save`

Save the current conversation to DialogueDB.

```
You: Save this session to DialogueDB with label "Auth refactoring"

Goose: ✓ Session saved. Resume ID: conv_abc123
```

**Parameters:**
- `messages` (required) - Array of conversation messages
- `label` - Human-readable label
- `id` - Custom session ID (auto-generated if not provided)
- `state` - Conversation state/context to persist
- `tags` - Tags for categorization
- `metadata` - Additional metadata

### `dialoguedb_resume`

Load a previously saved session.

```
You: Resume session conv_abc123

Goose: Loaded session with 15 messages. Last modified 2 hours ago.
       Continuing from: "Let's implement the OAuth flow..."
```

**Parameters:**
- `id` (required) - Session ID to resume
- `loadMessages` - Whether to load message history (default: true)

### `dialoguedb_search`

Search across all saved sessions.

```
You: Search my sessions for "authentication middleware"

Goose: Found 3 relevant sessions:
       1. "Auth refactoring" (conv_abc123) - 2 days ago
       2. "Security review" (conv_def456) - 1 week ago
       3. "API design" (conv_ghi789) - 2 weeks ago
```

**Parameters:**
- `query` (required) - Search query
- `limit` - Maximum results (default: 10)
- `searchMessages` - Also search message content (default: false)

### `dialoguedb_list`

List saved sessions with optional filters.

**Parameters:**
- `limit` - Maximum results (default: 20)
- `order` - Sort order: "asc" or "desc" (default: desc)
- `startDate` - Filter by creation date (ISO format)
- `endDate` - Filter by creation date (ISO format)

### `dialoguedb_add_message`

Add a message to an existing session.

**Parameters:**
- `sessionId` (required) - Session to add to
- `role` (required) - Message role (user, assistant, system, tool)
- `content` (required) - Message content
- `name` - Optional sender name

### `dialoguedb_update_state`

Update conversation state/context.

**Parameters:**
- `sessionId` (required) - Session to update
- `state` (required) - State object
- `merge` - Merge with existing state (default: true)

### `dialoguedb_create_thread`

Create a branching conversation from an existing session.

**Parameters:**
- `parentId` (required) - Parent session ID
- `label` - Label for the new thread
- `tags` - Tags for the new thread

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DIALOGUEDB_API_KEY` | Your DialogueDB API key | Yes |
| `DIALOGUEDB_BASE_URL` | Custom API endpoint (for self-hosted) | No |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with MCP Inspector for debugging
npm run inspect

# Watch mode for development
npm run dev
```

## Use Cases

### Cross-Device Continuity

Start a conversation on your laptop, continue on your desktop:

```
# On laptop
You: Save this session for later

# On desktop
You: Resume my session about the auth refactoring
```

### Team Collaboration

Share conversation context with teammates:

```
You: Save this session with tag "team-review"

# Teammate can then:
You: Search sessions tagged "team-review"
```

### CI/CD Integration

Persist automated agent runs for analysis:

```yaml
# GitHub Actions
- name: Run Analysis
  env:
    DIALOGUEDB_API_KEY: ${{ secrets.DIALOGUEDB_API_KEY }}
  run: |
    goose run --with-extension dialogue-db-mcp \
      "Analyze this PR and save findings to DialogueDB"
```

### Context Preservation

Never lose important context when hitting token limits:

```
You: Save the current state before we compact

# After compaction
You: What was our previous discussion about error handling?
# Search your saved sessions to recover context
```

## License

MIT

## Links

- [DialogueDB](https://dialoguedb.com)
- [Documentation](https://docs.dialoguedb.com)
- [MCP Specification](https://modelcontextprotocol.io)
