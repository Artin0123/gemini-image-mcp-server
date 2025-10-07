# image-mcp-server-gemini

[![smithery badge](https://smithery.ai/badge/@Artin0123/gemini-image-mcp-server)](https://smithery.ai/server/@Artin0123/gemini-image-mcp-server)
> An MCP server that receives image/video URLs or local file and analyzes their content using the Gemini models.

## Features

- Analyzes content from one or more image/video URLs or local file.
- Analyzes videos directly from YouTube URLs.
- Configurable default model selection and per-tool disable lists.

## Installation

### Installing via Smithery

To install Image Analysis Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@Artin0123/gemini-image-mcp-server):

```bash
npx -y @smithery/cli install @Artin0123/gemini-image-mcp-server --client claude
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/Artin0123/gemini-image-mcp-server.git 
cd image-mcp-server-gemini

# Install dependencies
npm install

# Compile TypeScript
npm run build
```

## Configuration

You need a Gemini API key before the server can talk to Google Gemini.

1. Sign in with your Google account and visit [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Create a new API key (Gemini 2.0 Flash works on the free tier in supported regions) and copy it somewhere safe.

### Provide the key to the server

Pick whichever option fits your workflow:

**Option A – `.env` file**

```bash
cp .env.example .env
```

Edit `.env` and set:

```
GEMINI_API_KEY=your_gemini_api_key
```

The server automatically looks for `.env` in the current working directory, the compiled `dist/` folder, and the project root, so it still picks up your secrets even if an MCP client launches the process from a different directory.

**Option B – JSON configuration**

Add the variables directly to your MCP configuration file. Supplying `cwd` keeps relative paths predictable and avoids `.env` discovery issues.

```json
{
  "mcpServers": {
    "image-video-analysis": {
      "command": "node",
      "args": ["/path/to/image-mcp-server-gemini/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key",
        "GEMINI_MODEL": "gemini-flash-lite-latest",
        "MCP_DISABLED_TOOLS": "analyze_video"
      }
    }
  }
}
```

 Optional environment variables let you customise behaviour without code changes:

- `DEFAULT_MODEL_NAME`: Override the default Gemini model (defaults to `gemini-flash-lite-latest`).
- `DISABLED_TOOLS`: Comma- or JSON-separated list of tool names to disable (e.g. `analyze_video`). Disabled tools are hidden from clients and respond with a configuration error if invoked directly.

When deploying through Smithery's TypeScript runtime, these options are also surfaced in the hosted configuration UI. The server exports a schema requiring the Gemini API key and exposing optional `modelName` and `disabledTools` fields, so operators can manage them without editing environment variables.

## MCP Server Configuration

```json
{
  "mcpServers": {
    "gemini-vision": { // Consider renaming for clarity
      "command": "node",
      "args": ["/path/to/image-mcp-server-gemini/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key"
      }
    }
  }
}
```

## Usage

Once the MCP server is configured, the following tools become available:

- `analyze_image`: Receives one or more image URLs and analyzes their content.
- `analyze_image_local`: Receives one or more local image file paths and analyzes their content.
- `analyze_video`: Receives one or more video URLs and analyzes their content. Best for smaller videos (see Video Notes).
- `analyze_video_local`: Receives one or more local video file paths and analyzes their content. Best for smaller videos (see Video Notes).
- `analyze_youtube_video`: Receives a single YouTube video URL and analyzes its content.

### Usage Examples

**Analyzing a single image from URL:**
```
Please analyze this image: https://example.com/image.jpg
```

**Analyzing multiple images from local paths and comparing them:**
```
Analyze these images: /path/to/your/image1.png, /path/to/your/image2.jpeg. Which one contains a cat?
```

**Analyzing a video from URL with a specific prompt:**
```
Summarize the content of this video: https://example.com/video.mp4
```

**Analyzing a YouTube video:**
```
What is the main topic of this YouTube video? https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### Video Notes

- **Size Limit:** For videos provided via URL (`analyze_video`) or path (`analyze_video_from_path`), Gemini currently has limitations on the size of video data that can be processed directly (typically around 20MB after Base64 encoding). Larger videos may fail. YouTube analysis does not have this same client-side download limit.
- **Supported MIME Types:** The server attempts to map and use MIME types supported by Gemini for video. Officially supported types include: `video/mp4`, `video/mpeg`, `video/mov`, `video/avi`, `video/x-flv`, `video/mpg`, `video/webm`, `video/wmv`, `video/3gpp`. Files with other MIME types might be skipped. YouTube videos are handled separately.

## Development

```bash
npm run install

npm run build

# Run unit tests (path resolution, configuration parsing, media prompts)
npm test

# Build a Smithery deployment bundle
npm run smithery:build
```

## Special thanks
- [image-mcp-server-gemini](https://github.com/murataskin/image-mcp-server-gemini)
- [image-mcp-server](https://github.com/champierre/image-mcp-server)

## License

MIT
