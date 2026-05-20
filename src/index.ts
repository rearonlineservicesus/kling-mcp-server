import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import axios from "axios";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const SECRET_KEY = process.env.KLING_SECRET_KEY;

const API_BASE_URL =
  process.env.KLING_API_BASE_URL ||
  "https://api-singapore.klingai.com";

if (!ACCESS_KEY || !SECRET_KEY) {
  throw new Error(
    "Missing KLING_ACCESS_KEY or KLING_SECRET_KEY environment variable."
  );
}

function createKlingToken() {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iss: ACCESS_KEY,
      exp: now + 1800,
      nbf: now - 5,
    },
    SECRET_KEY as string,
    {
      algorithm: "HS256",
      header: {
        alg: "HS256",
        typ: "JWT",
      },
    }
  );
}

async function klingRequest(
  path: string,
  options: any = {}
) {
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
    aspect_ratio: z
      .enum(["16:9", "9:16", "1:1"])
      .default("16:9"),
  },
  async (args) => {
    const result = await klingRequest(
      "/v1/videos/text2video",
      {
        method: "POST",
        data: args,
      }
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
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
    const result = await klingRequest(
      "/v1/videos/image2video",
      {
        method: "POST",
        data: args,
      }
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "kling_get_video_task",
  "Get Kling AI task status.",
  {
    task_id: z.string(),
    task_type: z
      .enum(["text2video", "image2video"])
      .default("text2video"),
  },
  async ({ task_id, task_type }) => {
    const result = await klingRequest(
      `/v1/videos/${task_type}/${task_id}`,
      {
        method: "GET",
      }
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

const app = express();

app.use(cors());
app.use(express.json());

const transports: Record<string, SSEServerTransport> = {};

app.get("/", (_req, res) => {
  res.json({
    status: "Kling AI SSE MCP Server running",
    endpoint: "/sse",
  });
});

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport(
    "/messages",
    res
  );

  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;

  const transport = transports[sessionId];

  if (!transport) {
    res.status(400).send("No transport found");
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Kling AI SSE MCP Server running on port ${PORT}`
  );
});