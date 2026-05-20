#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import jwt from "jsonwebtoken";
import { z } from "zod";

const ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const SECRET_KEY = process.env.KLING_SECRET_KEY;
const API_BASE = process.env.KLING_API_BASE ?? "https://api-singapore.klingai.com";

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error("Missing KLING_ACCESS_KEY or KLING_SECRET_KEY environment variable.");
  process.exit(1);
}

function klingToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: ACCESS_KEY,
      exp: now + 1800,
      nbf: now - 5
    },
    SECRET_KEY as string,
    {
      algorithm: "HS256",
      header: {
        alg: "HS256",
        typ: "JWT"
      }
    }
  );
}

async function klingRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${klingToken()}`,
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Kling API error ${response.status}: ${JSON.stringify(body)}`);
  }

  return body as T;
}

const server = new McpServer({
  name: "kling-mcp-server",
  version: "0.1.0"
});

server.tool(
  "kling_text_to_video",
  "Create a Kling AI text-to-video generation task.",
  {
    prompt: z.string().min(1).max(2500),
    model_name: z.string().default("kling-v3"),
    mode: z.enum(["std", "pro", "4k"]).default("std"),
    duration: z.string().default("5"),
    aspect_ratio: z.string().default("16:9"),
    negative_prompt: z.string().optional(),
    cfg_scale: z.number().min(0).max(1).optional(),
    external_task_id: z.string().optional()
  },
  async (args) => {
    const result = await klingRequest("/v1/videos/text2video", {
      method: "POST",
      body: JSON.stringify(args)
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "kling_image_to_video",
  "Create a Kling AI image-to-video generation task. image must be a URL or base64 string accepted by Kling.",
  {
    image: z.string().min(1),
    prompt: z.string().max(2500).optional(),
    model_name: z.string().default("kling-v3"),
    mode: z.enum(["std", "pro", "4k"]).default("std"),
    duration: z.string().default("5"),
    aspect_ratio: z.string().default("16:9"),
    negative_prompt: z.string().optional(),
    cfg_scale: z.number().min(0).max(1).optional(),
    external_task_id: z.string().optional()
  },
  async (args) => {
    const result = await klingRequest("/v1/videos/image2video", {
      method: "POST",
      body: JSON.stringify(args)
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "kling_get_video_task",
  "Get the status/result of a Kling AI video generation task.",
  {
    task_id: z.string().optional(),
    external_task_id: z.string().optional(),
    task_type: z.enum(["text2video", "image2video"]).default("text2video")
  },
  async ({ task_id, external_task_id, task_type }) => {
    if (!task_id && !external_task_id) {
      throw new Error("Provide either task_id or external_task_id.");
    }

    const query = new URLSearchParams();
    if (external_task_id) query.set("external_task_id", external_task_id);

    const path = task_id
      ? `/v1/videos/${task_type}/${encodeURIComponent(task_id)}`
      : `/v1/videos/${task_type}?${query.toString()}`;

    const result = await klingRequest(path, { method: "GET" });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
