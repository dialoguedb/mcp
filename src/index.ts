#!/usr/bin/env node
/**
 * DialogueDB MCP Server
 *
 * Provides tools for persisting and searching AI conversations
 * across devices using DialogueDB.
 *
 * Usage:
 *   DIALOGUEDB_API_KEY=your-key npx @dialoguedb/mcp
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, type ToolName } from "./server.js";

async function main() {
  const apiKey = process.env.DIALOGUEDB_API_KEY;

  if (!apiKey) {
    // IMPORTANT: Use stderr, not stdout (stdout breaks MCP stdio transport)
    console.error(
      "Warning: DIALOGUEDB_API_KEY not set. Some operations may fail."
    );
  }

  // Optional: limit which tools are exposed via comma-separated list
  // e.g. DIALOGUEDB_TOOLS=create_memory,search_memories,search_dialogues
  const tools = process.env.DIALOGUEDB_TOOLS
    ? (process.env.DIALOGUEDB_TOOLS.split(",").map((t) => t.trim()) as ToolName[])
    : undefined;

  const server = createServer({ apiKey, tools });
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error("DialogueDB MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
