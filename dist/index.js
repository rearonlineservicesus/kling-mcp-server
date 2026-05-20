import dotenv from "dotenv";
dotenv.config();
import express from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
const ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const SECRET_KEY = process.env.KLING_SECRET_KEY;
const API_BASE_URL = process.env.KLING_API_BASE_URL || "https://api-singapore.klingai.com";
if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error("Missing KLING_ACCESS_KEY or KLING_SECRET_KEY");
}
function createKlingToken() {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({
        iss: ACCESS_KEY,
        exp: now + 1800,
        nbf: now - 5,
    }, SECRET_KEY, {
        algorithm: "HS256",
        header: {
            alg: "HS256",
            typ: "JWT",
        },
    });
}
async function klingRequest(path, options = {}) {
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
server.tool("kling_text_to_video", "Create a Kling AI video from a text prompt.", {
    prompt: z.string(),
    model_name: z.string().default("kling-v1"),
    negative_prompt: z.string().optional(),
    cfg_scale: z.number().optional(),
    mode: z.enum(["std", "pro"]).default("std"),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    duration: z.enum(["5", "10"]).default("5"),
}, async (args) => {
    const result = await klingRequest("/v1/videos/text2video", {
        method: "POST",
        data: args,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
});
server.tool("kling_image_to_video", "Create a Kling AI video from an image URL and prompt.", {
    image: z.string(),
    prompt: z.string().optional(),
    model_name: z.string().default("kling-v1"),
    negative_prompt: z.string().optional(),
    cfg_scale: z.number().optional(),
    mode: z.enum(["std", "pro"]).default("std"),
    duration: z.enum(["5", "10"]).default("5"),
}, async (args) => {
    const result = await klingRequest("/v1/videos/image2video", {
        method: "POST",
        data: args,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
});
server.tool("kling_get_video_task", "Get the status/result of a Kling AI video generation task.", {
    task_id: z.string().optional(),
    external_task_id: z.string().optional(),
    task_type: z.enum(["text2video", "image2video"]).default("text2video"),
}, async ({ task_id, external_task_id, task_type }) => {
    if (!task_id && !external_task_id) {
        throw new Error("Provide either task_id or external_task_id.");
    }
    const query = new URLSearchParams();
    if (external_task_id)
        query.set("external_task_id", external_task_id);
    const path = task_id
        ? `/v1/videos/${task_type}/${encodeURIComponent(task_id)}`
        : `/v1/videos/${task_type}?${query.toString()}`;
    const result = await klingRequest(path, { method: "GET" });
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
});
const app = express();
app.use(express.json());
app.get("/", (_req, res) => {
    res.json({
        status: "Kling AI Remote MCP Server running",
        mcp_endpoint: "/mcp",
    });
});
app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });
    res.on("close", () => {
        transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});
const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kling AI Remote MCP Server running on port ${PORT}`);
});
