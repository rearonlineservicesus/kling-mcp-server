# Kling MCP Server

Minimaler MCP-Server für Kling AI Video-Generierung.

## Setup

```bash
npm install
npm run build
```

Environment:

```bash
export KLING_ACCESS_KEY="..."
export KLING_SECRET_KEY="..."
export KLING_API_BASE="https://api-singapore.klingai.com"
```

## Claude Desktop Beispiel

```json
{
  "mcpServers": {
    "kling": {
      "command": "node",
      "args": ["/absolute/path/to/kling-mcp-server/dist/index.js"],
      "env": {
        "KLING_ACCESS_KEY": "your_access_key",
        "KLING_SECRET_KEY": "your_secret_key",
        "KLING_API_BASE": "https://api-singapore.klingai.com"
      }
    }
  }
}
```

## Tools

- `kling_text_to_video`
- `kling_image_to_video`
- `kling_get_video_task`

Hinweis: Kling API-Parameter können sich ändern. Passe bei Bedarf die Pfade und Payload-Felder in `src/index.ts` an die offizielle Dokumentation an.
