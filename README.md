# image-mcp-server-gemini

[![smithery badge](https://smithery.ai/badge/@Artin0123/gemini-image-mcp-server)](https://smithery.ai/server/@Artin0123/gemini-image-mcp-server)
> analyzing remote images and videos with Google Gemini.

## Features

- Analyze one or more image URLs with a single tool call.
- Analyze remote video URLs (including YouTube) without downloading files locally.
- Simple configuration: supply an API key and optionally override the Gemini model via a single environment variable.

## Installation

### Installing via Smithery

Install the server in Claude Desktop (or any Smithery-compatible client) with:

```bash
npx -y @smithery/cli install @Artin0123/gemini-image-mcp-server --client claude
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/Artin0123/image-mcp-server-gemini.git
cd image-mcp-server-gemini

# Install dependencies
npm install

# Compile TypeScript to dist/
npm run build
```

## Configuration

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey) and provide `GEMINI_API_KEY` to the server.

Most MCP clients let you inject these values directly in their configuration. Example Smithery entry:

```json
{
  "mcpServers": {
    "gemini-media": {
      "command": "node",
      "args": ["/absolute/path/to/image-mcp-server-gemini/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here",
        "MCP_GEMINI_MODEL": "gemini-flash-lite-latest"
      }
    }
  }
}
```

If no key is supplied, the server can still start (handy for automated scans), but any tool invocation will return a configuration error until a valid API key is configured.

### Model override

The server defaults to `gemini-flash-lite-latest`. Override it by either:

- Setting the `MCP_GEMINI_MODEL` environment variable, or
- Providing `modelName` in the Smithery/SDK configuration schema.

Any other historical variable names (e.g. `GEMINI_MODEL`, `GEMINI_MODEL_NAME`, `GOOGLE_GEMINI_MODEL`) are no longer recognised.

## Available tools

- `analyze_image`: Analyze one or more image URLs.
- `analyze_video`: Analyze one or more video URLs.
- `analyze_youtube_video`: Analyze a single YouTube video URL.

All tools treat URLs as remote references and forward them directly to Gemini using wildcard MIME types (`image/*` or `video/*`). No files are downloaded or uploaded by this server.

### Prompt examples

```
Please analyze this product photo: https://example.com/images/catalog-item.png
```

```
Summarize the key moments in this event recap: https://example.com/videos/highlights.mp4
```

```
Extract the main talking points from this clip: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

## Development

```bash
npm install
npm test
npm run build
```

The test suite exercises URL forwarding, MIME handling, and configuration fallbacks.

## License

MIT
