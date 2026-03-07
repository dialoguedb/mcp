/**
 * DialogueDB MCP Server
 *
 * Exposes DialogueDB functionality as MCP tools for AI agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DialogueDB, api } from "dialogue-db";

// Message schema for Goose/AI agent conversations
const MessageSchema = z.object({
  role: z.string().describe("Message role (user, assistant, system, tool)"),
  content: z
    .union([z.string(), z.record(z.any()), z.array(z.record(z.any()))])
    .describe("Message content"),
  name: z.string().optional().describe("Optional name for the message sender"),
  id: z.string().optional().describe("Optional message ID"),
  created: z
    .string()
    .optional()
    .describe("Optional ISO timestamp for when message was created"),
});

export const ALL_TOOLS = [
  "save_dialogue",
  "resume_dialogue",
  "search_dialogues",
  "list_dialogues",
  "add_message",
  "update_dialogue_state",
  "create_thread",
  "list_messages",
  "create_memory",
  "search_memories",
  "list_memories",
  "get_memory",
  "delete_memory",
  "update_memory_tags",
] as const;

export type ToolName = (typeof ALL_TOOLS)[number];

export interface ServerConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Whitelist of tools to register. Defaults to all. */
  tools?: ToolName[];
}

export function createServer(config: ServerConfig = {}) {
  const server = new McpServer({
    name: "dialoguedb",
    version: "0.1.0",
  });

  const enabledTools = new Set<ToolName>(config.tools ?? ALL_TOOLS);
  const enabled = (tool: ToolName) => enabledTools.has(tool);

  // Initialize DialogueDB client
  const db = new DialogueDB({
    apiKey: config.apiKey,
    ...(config.baseUrl && { baseUrl: config.baseUrl }),
  });

  // ============================================
  // TOOL: Save Session
  // ============================================
  if (enabled("save_dialogue")) server.tool(
    "dialoguedb_save",
    "Save the current conversation to DialogueDB for cross-device access and persistence. Returns a session ID that can be used to resume later.",
    {
      id: z
        .string()
        .optional()
        .describe(
          "Optional session ID. If not provided, a new ID will be generated."
        ),
      label: z
        .string()
        .optional()
        .describe(
          "Human-readable label for the session (e.g., 'Refactoring auth system')"
        ),
      messages: z
        .array(MessageSchema)
        .describe("Array of conversation messages to save"),
      state: z
        .record(z.any())
        .optional()
        .describe("Optional conversation state/context to persist"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Optional tags for categorization"),
      metadata: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe(
          "Optional metadata (e.g., working directory, extensions used)"
        ),
    },
    async ({ id, label, messages, state, tags, metadata }) => {
      try {
        const dialogue = await db.createDialogue({
          ...(id && { id }),
          ...(label && { label }),
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.name && { name: m.name }),
            ...(m.id && { id: m.id }),
            ...(m.created && { created: m.created }),
          })),
          ...(state && { state }),
          ...(tags && { tags }),
          metadata: {
            source: "goose-mcp",
            savedAt: new Date().toISOString(),
            ...metadata,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  sessionId: dialogue.id,
                  messageCount: dialogue.messages.length,
                  label: dialogue.label,
                  message: `Session saved successfully. Resume with ID: ${dialogue.id}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Resume Session
  // ============================================
  if (enabled("resume_dialogue")) server.tool(
    "dialoguedb_resume",
    "Load a previously saved session from DialogueDB. Returns the full conversation history and state.",
    {
      id: z.string().describe("Session ID to resume"),
      loadMessages: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to load message history (default: true)"),
    },
    async ({ id, loadMessages }) => {
      try {
        const dialogue = await db.getDialogue(id);

        if (!dialogue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Session not found: ${id}`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Load messages if requested
        if (loadMessages) {
          await dialogue.loadMessages();
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  session: {
                    id: dialogue.id,
                    label: dialogue.label,
                    status: dialogue.status,
                    state: dialogue.state,
                    tags: dialogue.tags,
                    metadata: dialogue.metadata,
                    messageCount: dialogue.messages.length,
                    messages: dialogue.messages.map((m) => ({
                      id: m.id,
                      role: m.role,
                      content: m.content,
                      created: m.created,
                    })),
                    created: dialogue.created,
                    modified: dialogue.modified,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Search Sessions
  // ============================================
  if (enabled("search_dialogues")) server.tool(
    "dialoguedb_search",
    "Search across all saved sessions by content, finding relevant conversations from your history.",
    {
      query: z.string().describe("Search query"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results (default: 10)"),
      searchMessages: z
        .boolean()
        .optional()
        .default(false)
        .describe("Also search within message content (default: false)"),
    },
    async ({ query, limit, searchMessages }) => {
      try {
        const dialogues = await db.searchDialogues(query, { limit });

        const results = dialogues.map((d) => ({
          id: d.id,
          label: d.label,
          tags: d.tags,
          messageCount: d.totalMessages,
          created: d.created,
          modified: d.modified,
        }));

        // Optionally search messages too
        let messageResults: Array<{
          messageId: string;
          role: string;
          contentPreview: string;
        }> = [];

        if (searchMessages) {
          const messages = await db.searchMessages(query, { limit });
          messageResults = messages.map((m) => ({
            messageId: m.id,
            role: m.role,
            contentPreview:
              typeof m.content === "string"
                ? m.content.slice(0, 200)
                : JSON.stringify(m.content).slice(0, 200),
          }));
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  query,
                  dialogueCount: results.length,
                  dialogues: results,
                  ...(searchMessages && {
                    messageCount: messageResults.length,
                    messages: messageResults,
                  }),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: List Sessions
  // ============================================
  if (enabled("list_dialogues")) server.tool(
    "dialoguedb_list",
    "List saved sessions, optionally filtered by date range or tags.",
    {
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of results (default: 20)"),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .default("desc")
        .describe("Sort order by creation date (default: desc)"),
      startDate: z
        .string()
        .optional()
        .describe("Filter sessions created after this ISO date"),
      endDate: z
        .string()
        .optional()
        .describe("Filter sessions created before this ISO date"),
    },
    async ({ limit, order, startDate, endDate }) => {
      try {
        const result = await db.listDialogues({
          limit,
          order,
          ...(startDate && { startDate }),
          ...(endDate && { endDate }),
        });

        const sessions = result.items.map((d) => ({
          id: d.id,
          label: d.label,
          status: d.status,
          tags: d.tags,
          messageCount: d.totalMessages,
          created: d.created,
          modified: d.modified,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  count: sessions.length,
                  hasMore: !!result.next,
                  sessions,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Add Message
  // ============================================
  if (enabled("add_message")) server.tool(
    "dialoguedb_add_message",
    "Add a new message to an existing session.",
    {
      sessionId: z.string().describe("Session ID to add message to"),
      role: z.string().describe("Message role (user, assistant, system, tool)"),
      content: z
        .union([z.string(), z.record(z.any()), z.array(z.record(z.any()))])
        .describe("Message content"),
      name: z
        .string()
        .optional()
        .describe("Optional name for the message sender"),
    },
    async ({ sessionId, role, content, name }) => {
      try {
        const dialogue = await db.getDialogue(sessionId);

        if (!dialogue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Session not found: ${sessionId}`,
                }),
              },
            ],
            isError: true,
          };
        }

        const message = await dialogue.saveMessage({
          role,
          content,
          ...(name && { name }),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  messageId: message.id,
                  sessionId: dialogue.id,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: List Messages
  // ============================================
  if (enabled("list_messages")) server.tool(
    "dialoguedb_list_messages",
    "Load messages from a specific dialogue. Use after searching or listing dialogues to read the actual conversation content.",
    {
      dialogueId: z.string().describe("Dialogue ID to load messages from"),
      limit: z
        .number()
        .optional()
        .default(50)
        .describe("Maximum number of messages to return (default: 50)"),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .default("asc")
        .describe("Sort order (default: asc — oldest first)"),
    },
    async ({ dialogueId, limit, order }) => {
      try {
        const dialogue = await db.getDialogue(dialogueId);

        if (!dialogue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Dialogue not found: ${dialogueId}`,
                }),
              },
            ],
            isError: true,
          };
        }

        const messages = await dialogue.loadMessages({ limit, order });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  dialogueId: dialogue.id,
                  label: dialogue.label,
                  count: messages.length,
                  hasMore: dialogue.hasMoreMessages,
                  messages: messages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    name: m.name,
                    created: m.created,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Update Session State
  // ============================================
  if (enabled("update_dialogue_state")) server.tool(
    "dialoguedb_update_state",
    "Update the state/context of an existing session. Useful for persisting conversation context, preferences, or working state.",
    {
      sessionId: z.string().describe("Session ID to update"),
      state: z.record(z.any()).describe("New state object (replaces existing)"),
      merge: z
        .boolean()
        .optional()
        .default(true)
        .describe("Merge with existing state (default: true) or replace"),
    },
    async ({ sessionId, state, merge }) => {
      try {
        const dialogue = await db.getDialogue(sessionId);

        if (!dialogue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Session not found: ${sessionId}`,
                }),
              },
            ],
            isError: true,
          };
        }

        const newState = merge ? { ...dialogue.state, ...state } : state;

        await dialogue.saveState(newState);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  sessionId: dialogue.id,
                  state: dialogue.state,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Create Thread
  // ============================================
  if (enabled("create_thread")) server.tool(
    "dialoguedb_create_thread",
    "Create a new thread (sub-conversation) from an existing session. Useful for branching conversations or exploring alternatives.",
    {
      parentId: z.string().describe("Parent session ID to branch from"),
      label: z.string().optional().describe("Label for the new thread"),
      tags: z.array(z.string()).optional().describe("Tags for the new thread"),
    },
    async ({ parentId, label, tags }) => {
      try {
        const parent = await db.getDialogue(parentId);

        if (!parent) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Parent session not found: ${parentId}`,
                }),
              },
            ],
            isError: true,
          };
        }

        const thread = await parent.createThread({
          ...(tags && { tags }),
        });

        // Set label if provided
        if (label) {
          thread.label = label;
          await thread.save();
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  threadId: thread.id,
                  parentId: parent.id,
                  label: thread.label,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Create Memory
  // ============================================
  if (enabled("create_memory")) server.tool(
    "dialoguedb_create_memory",
    "Create a persistent memory — a fact, preference, or piece of knowledge that persists across all conversations. Use this to remember things like user preferences, important facts, project context, decisions, etc.",
    {
      value: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.any()),
          z.array(z.record(z.any())),
        ])
        .describe("The memory content — a string, number, boolean, or structured object"),
      label: z
        .string()
        .optional()
        .describe("Short human-readable label (e.g., 'Preferred language', 'Project stack')"),
      description: z
        .string()
        .optional()
        .describe("Longer description of what this memory represents"),
      namespace: z
        .string()
        .optional()
        .describe("Optional namespace for organizing memories (e.g., user ID, project name)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for categorization (e.g., ['preference', 'coding'])"),
      metadata: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Optional metadata"),
    },
    async ({ value, label, description, namespace, tags, metadata }) => {
      try {
        const memory = await db.createMemory({
          value,
          ...(label && { label }),
          ...(description && { description }),
          ...(namespace && { namespace }),
          ...(tags && { tags }),
          ...(metadata && { metadata }),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  memoryId: memory.id,
                  label: memory.label,
                  message: `Memory created: ${memory.label || memory.id}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Search Memories
  // ============================================
  if (enabled("search_memories")) server.tool(
    "dialoguedb_search_memories",
    "Semantically search across all stored memories. Use this to recall facts, preferences, or knowledge that was previously saved.",
    {
      query: z.string().describe("Natural language search query (e.g., 'preferred programming language', 'project deadlines')"),
      namespace: z
        .string()
        .optional()
        .describe("Optional namespace to scope the search"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Optional tags to filter by"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results (default: 10)"),
    },
    async ({ query, namespace, tags, limit }) => {
      try {
        const memories = await db.searchMemories(query, {
          limit,
          ...(tags && { filter: { tags } }),
          ...(namespace && { metadata: { namespace } }),
        });

        const results = memories.map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description,
          value: m.value,
          tags: m.tags,
          namespace: m.namespace,
          created: m.created,
          modified: m.modified,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  query,
                  count: results.length,
                  memories: results,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: List Memories
  // ============================================
  if (enabled("list_memories")) server.tool(
    "dialoguedb_list_memories",
    "List all stored memories, optionally filtered by namespace or date range.",
    {
      namespace: z
        .string()
        .optional()
        .describe("Filter by namespace"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of results (default: 20)"),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .default("desc")
        .describe("Sort order by creation date (default: desc)"),
    },
    async ({ namespace, limit, order }) => {
      try {
        const result = await api.memory.list({
          limit,
          order,
          ...(namespace && { namespace }),
        });

        const memories = result.items.map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description,
          value: m.value,
          tags: m.tags,
          namespace: m.namespace,
          created: m.created,
          modified: m.modified,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  count: memories.length,
                  hasMore: !!result.next,
                  memories,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Get Memory
  // ============================================
  if (enabled("get_memory")) server.tool(
    "dialoguedb_get_memory",
    "Retrieve a specific memory by its ID.",
    {
      id: z.string().describe("Memory ID to retrieve"),
    },
    async ({ id }) => {
      try {
        const memory = await db.getMemory(id);

        if (!memory) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Memory not found: ${id}`,
                }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  memory: {
                    id: memory.id,
                    label: memory.label,
                    description: memory.description,
                    value: memory.value,
                    tags: memory.tags,
                    namespace: memory.namespace,
                    metadata: memory.metadata,
                    created: memory.created,
                    modified: memory.modified,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Delete Memory
  // ============================================
  if (enabled("delete_memory")) server.tool(
    "dialoguedb_delete_memory",
    "Delete a memory by its ID.",
    {
      id: z.string().describe("Memory ID to delete"),
    },
    async ({ id }) => {
      try {
        await api.memory.remove({ id });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `Memory deleted: ${id}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================
  // TOOL: Update Memory Tags
  // ============================================
  if (enabled("update_memory_tags")) server.tool(
    "dialoguedb_update_memory_tags",
    "Update the tags on an existing memory.",
    {
      id: z.string().describe("Memory ID to update"),
      tags: z.array(z.string()).describe("New tags to set on the memory"),
    },
    async ({ id, tags }) => {
      try {
        const memory = await db.getMemory(id);

        if (!memory) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Memory not found: ${id}`,
                }),
              },
            ],
            isError: true,
          };
        }

        await memory.saveTags(tags);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  memoryId: memory.id,
                  tags: memory.tags,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
