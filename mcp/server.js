#!/usr/bin/env node
// MD Reviewer MCP server（stdio transport）
// 只負責註冊工具與接線 transport；所有工具邏輯在 ./tools.js。
// 用法：node mcp/server.js（或 npm run mcp）。

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolList, tools } from './tools.js';

const server = new Server(
  { name: 'md-reviewer', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// tools/list：回傳工具清單（name、description、JSON inputSchema）
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolList.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// tools/call：分派到對應 handler，handler 內已 try/catch 並回傳結構化錯誤
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const tool = tools[name];
  if (!tool) {
    return {
      isError: true,
      content: [{ type: 'text', text: `錯誤：未知的工具 ${name}` }],
    };
  }
  try {
    return await tool.handler(args || {});
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `錯誤：工具 ${name} 執行失敗：${e?.message || String(e)}` }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 模式下不可寫 stdout（會污染 JSON-RPC），用 stderr 記錄
  console.error('[md-reviewer-mcp] server 已啟動（stdio）');
}

main().catch((err) => {
  console.error('[md-reviewer-mcp] 啟動失敗', err);
  process.exit(1);
});
