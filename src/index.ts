import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import cors from "cors";
import axios from "axios";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const SECRET_KEY = process.env.KLING_SECRET_KEY;
const API_BASE_URL =
  process.env.KLING_API_BASE_URL || "https://api-singapore.klingai.com";

if (!ACCESS_KEY || !SECRET_KEY) {
  throw new Error("Missing KLING_ACCESS_KEY or KLING_SECRET_KEY env variable.");
}

function createKlingToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: ACCESS_KEY, exp: now + 1800, nbf: now - 5 },
    SECRET_KEY as string,
    { algorithm: "HS256", header: { alg: "HS256", typ: "JWT" } }
  );
}

async function klingRequest(path: string, options: any = {}) {
  const token = createKlingToken();
  const response = await axios({
    baseURL: API_BASE_URL,
    url: path,
    method: options.method || "GET",
    data: options.data,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  return response.data;
}

// Build a fresh MCP server instance per session
function buildServer(): McpServer {
  const server = new McpServer({
    name: "kling-ai",
    version: "1.0.0",
  });

  server.tool(
    "kling_text_to_video",
    "Generate a Kling AI video from text.",
    {
      prompt: z.string(),
      negative_prompt: z.string().optional(),
      cfg_scale: z.number().optional(),
      mode: z.enum(["std", "pro"]).default("std"),
      duration: z.enum(["5", "10"]).default("5"),
      aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    },
    async (args) => {
      const result = await klingRequest("/v1/videos/text2video", {
        method: "POST",
        data: args,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "kling_image_to_video",
    "Generate a Kling AI video from an image.",
    {
      image: z.string(),
      prompt: z.string().optional(),
      mode: z.enum(["std", "pro"]).default("std"),
      duration: z.enum(["5", "10"]).default("5"),
    },
    async (args) => {
      const result = await klingRequest("/v1/videos/image2video", {
        method: "POST",
        data: args,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "kling_get_video_task",
    "Get Kling AI task status.",
    {
      task_id: z.string(),
      task_type: z.enum(["text2video", "image2video"]).default("text2video"),
    },
    async ({ task_id, task_type }) => {
      const result = await klingRequest(
        `/v1/videos/${task_type}/${task_id}`,
        { method: "GET" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  return server;
}

const app = express();

app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Mcp-Session-Id", "Authorization"],
  })
);
app.use(express.json());

// Health check
app.get("/", (_req, res) => {
  res.json({
    status: "Kling AI MCP Server running",
    transport: "Streamable HTTP",
    endpoint: "/mcp",
  });
});

const transports: Record<string, StreamableHTTPServerTransport> = {};

// Handle POST: client -> server messages (incl. initialization)
app.post("/mcp", async (req: Request, res: Response) => {
  console.log("[POST /mcp] session:", req.headers["mcp-session-id"]);

  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          console.log("[session initialized]", newId);
          transports[newId] = transport;
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log("[session closed]", transport.sessionId);
          delete transports[transport.sessionId];
        }
      };

      const server = buildServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: no valid session ID and not an initialize request",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[POST /mcp] error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Handle GET: server -> client streaming (SSE within Streamable HTTP)
app.get("/mcp", async (req: Request, res: Response) => {
  console.log("[GET /mcp] session:", req.headers["mcp-session-id"]);

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing Mcp-Session-Id header");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// Handle DELETE: explicit session termination
app.delete("/mcp", async (req: Request, res: Response) => {
  console.log("[DELETE /mcp] session:", req.headers["mcp-session-id"]);

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing Mcp-Session-Id header");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Kling AI MCP Server listening on port ${PORT}`);
  console.log(`Endpoint: POST/GET/DELETE /mcp`);
});