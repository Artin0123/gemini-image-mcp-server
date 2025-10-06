
# image-mcp-server-gemini

[![smithery badge](https://smithery.ai/badge/@Artin0123/gemini-image-mcp-server)](https://smithery.ai/server/@Artin0123/gemini-image-mcp-server)
An MCP server that receives image/video URLs or local file paths and analyzes their content using the Gemini models.

## Features

- Analyzes content from one or more image/video URLs or local file paths.
- Analyzes videos directly from YouTube URLs.
- Can analyze relationships between multiple images or videos provided together.
- Supports optional text prompts to guide the analysis.
- High-precision recognition and description using the Gemini 2.0 Flash model.
- URL validity checking and local file loading with Base64 encoding.
- Basic security checks for local file paths.
- Configurable default model selection and per-tool disable lists.
- Handles various image and video MIME types (see Usage section for details).

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
2. Create a new API key (Gemini 2.0 Flash works on the free tier in supported regions) and copy it somewhere safe. The `injecting env (0) from .env` console tip you may see is just advertising from the `dotenv` dependency—you **do not** need to register with dotenvx.

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
      "cwd": "/path/to/image-mcp-server-gemini",
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

- `GEMINI_MODEL`: Override the default Gemini model (defaults to `gemini-2.0-flash`).
- `DISABLED_TOOLS` / `MCP_DISABLED_TOOLS`: Comma- or JSON-separated list of tool names to disable (e.g. `analyze_video`). Disabled tools are hidden from clients and respond with a configuration error if invoked directly.

When deploying through Smithery's TypeScript runtime, these options are also surfaced in the hosted configuration UI. The server exports a schema requiring the Gemini API key and exposing optional `modelName` and `disabledTools` fields, so operators can manage them without editing environment variables.

## MCP Server Configuration

To use with tools like Cline, add the following settings to your MCP server configuration file:

### For Cline

Add the following to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "image-video-analysis": { // Consider renaming for clarity
      "command": "node",
      "args": ["/path/to/image-mcp-server-gemini/dist/index.js"],
      "cwd": "/path/to/image-mcp-server-gemini",
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key",
        "GEMINI_MODEL": "gemini-flash-lite-latest",
        "MCP_DISABLED_TOOLS": "analyze_video"
      }
    }
  }
}
```

### For Claude Desktop App

Add the following to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "image-video-analysis": { // Consider renaming for clarity
      "command": "node",
      "args": ["/path/to/image-mcp-server-gemini/dist/index.js"],
      "cwd": "/path/to/image-mcp-server-gemini",
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key",
        "GEMINI_MODEL": "gemini-flash-lite-latest",
        "MCP_DISABLED_TOOLS": "analyze_video"
      }
    }
  }
}
```

## Usage

Once the MCP server is configured, the following tools become available:

- `analyze_image`: Receives one or more image URLs and analyzes their content.
  - Arguments: `imageUrls` (array of strings, required), `prompt` (string, optional).
- `analyze_image_from_path`: Receives one or more local image file paths and analyzes their content.
  - Arguments: `imagePaths` (array of strings, required), `prompt` (string, optional).
- `analyze_video`: Receives one or more video URLs and analyzes their content. Best for smaller videos (see Video Notes).
  - Arguments: `videoUrls` (array of strings, required), `prompt` (string, optional).
- `analyze_video_from_path`: Receives one or more local video file paths and analyzes their content. Best for smaller videos (see Video Notes).
  - Arguments: `videoPaths` (array of strings, required), `prompt` (string, optional).
- `analyze_youtube_video`: Receives a single YouTube video URL and analyzes its content.
  - Arguments: `youtubeUrl` (string, required), `prompt` (string, optional).

### Remote deployments

When the server runs on Smithery or any other remote host, it cannot reach files that live on your local machine. Requests to the `..._from_path` tools must reference paths that exist on the remote host's filesystem; local-only paths will fail because the remote process has no access to them.

### Usage Examples

**Analyzing a single image from URL:**
```
Please analyze this image: https://example.com/image.jpg
```

**Analyzing multiple images from local paths and comparing them:**
```
Analyze these images: /path/to/your/image1.png, /path/to/your/image2.jpeg. Which one contains a cat?
```
*(The client would call `analyze_image_from_path` with `imagePaths: ["/path/to/your/image1.png", "/path/to/your/image2.jpeg"]` and `prompt: "Which one contains a cat?"`)*

**Analyzing a video from URL with a specific prompt:**
```
Summarize the content of this video: https://example.com/video.mp4
```
*(The client would call `analyze_video` with `videoUrls: ["https://example.com/video.mp4"]` and `prompt: "Summarize the content of this video"`)*

**Analyzing a YouTube video:**
```
What is the main topic of this YouTube video? https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
*(The client would call `analyze_youtube_video` with `youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"` and `prompt: "What is the main topic of this YouTube video?"`)*

### Video Notes

- **Size Limit:** For videos provided via URL (`analyze_video`) or path (`analyze_video_from_path`), Gemini currently has limitations on the size of video data that can be processed directly (typically around 20MB after Base64 encoding). Larger videos may fail. YouTube analysis does not have this same client-side download limit.
- **Supported MIME Types:** The server attempts to map and use MIME types supported by Gemini for video. Officially supported types include: `video/mp4`, `video/mpeg`, `video/mov`, `video/avi`, `video/x-flv`, `video/mpg`, `video/webm`, `video/wmv`, `video/3gpp`. Files with other MIME types might be skipped. YouTube videos are handled separately.

### Note: Specifying Local File Paths

When using the `..._from_path` tools, the AI assistant (client) must specify **valid file paths in the environment where this server is running**.

- **If the server is running on WSL:**
  - If the AI assistant has a Windows path (e.g., `C:\...`), it needs to convert it to a WSL path (e.g., `/mnt/c/...`) before passing it to the tool.
  - If the AI assistant has a WSL path, it can pass it as is.
- **If the server is running on Windows:**
  - If the AI assistant has a WSL path (e.g., `/home/user/...`), it needs to convert it to a UNC path (e.g., `\\wsl$\Distro\...`) before passing it to the tool.
  - If the AI assistant has a Windows path, it can pass it as is.

**Path conversion is the responsibility of the AI assistant (or its execution environment).** The server will try to interpret the received path as is, applying basic security checks.

The server will load any local media path that exists on the host machine, regardless of where the server process was started. For predictable results, supply absolute paths so the assistant never relies on an inherited current working directory.

### Note: Type Errors During Build

When running `npm run build`, you may see an error (TS7016) about missing TypeScript type definitions for the `mime-types` module.

```
src/index.ts:16:23 - error TS7016: Could not find a declaration file for module 'mime-types'. ...
```

This is a type checking error, and since the JavaScript compilation itself succeeds, it **does not affect the server's execution**. If you want to resolve this error, install the type definition file as a development dependency.

```bash
npm install --save-dev @types/mime-types
# or
yarn add --dev @types/mime-types
```

## Development

```bash
# Run in development mode
npm run dev

# Build a Smithery deployment bundle
npm run smithery:build

# Launch the Smithery CLI playground with hot reload
npm run smithery:dev

# Run unit tests (path resolution, configuration parsing, media prompts)
npm test
```

### Manual Gemini smoke test

Use the bundled script to quickly verify Gemini access without wiring an MCP client:

```bash
npm run test:gemini -- [optional-local-image] [optional-local-video]
```

- Omitting arguments analyzes a sample remote image and a YouTube clip.
- Provide a local image path and/or video path (keep inline video sources under ~20 MB) to include your own files in the request.
- You can override prompts or sample URLs with environment variables such as `IMAGE_PROMPT`, `VIDEO_PROMPT`, `SAMPLE_IMAGE_URL`, `SAMPLE_VIDEO_URL`, and `SAMPLE_YOUTUBE_URL`.

## Special thanks
- [image-mcp-server-gemini](https://github.com/murataskin/image-mcp-server-gemini)
- [image-mcp-server](https://github.com/champierre/image-mcp-server)

> Edited by GitHub Copilot

## License

MIT
