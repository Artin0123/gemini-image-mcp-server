# gemini-vision-mcp
> This version supports both remote URLs and local file paths for image and video analysis.

## Features

- Analyze one or more image URLs with a single tool call.
- Analyze local images using absolute file paths.
- Analyze YouTube videos without downloading files locally.
- Analyze local videos using absolute file paths.
- Supply an API key and optionally override the Gemini model via environment variables.
- **File size limit**: Images and videos are limited to 16 MB to ensure fast processing.
- **YouTube videos**: No size limit as they are streamed directly by Gemini API.

## Installation

### Installing via Smithery

Install the server in Claude Desktop:

```bash
npx -y @smithery/cli install @Artin0123/gemini-image-mcp-server --client claude
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/Artin0123/gemini-vision-mcp.git
cd gemini-vision-mcp

# Install dependencies
npm install

# Compile TypeScript to dist/
npm run build
```

## Configuration

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey) and provide `GEMINI_API_KEY` to the server.

```json
{
  "mcpServers": {
    "gemini-media": {
      "command": "node",
      "args": ["/absolute/path/to/gemini-vision-mcp/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here",
        "GEMINI_MODEL": "models/gemini-flash-lite-latest"
      }
    }
  }
}
```

If no key is supplied, the server can still start (handy for automated scans), but any tool invocation will return a configuration error until a valid API key is configured.

### Model override

The server defaults to `models/gemini-flash-lite-latest`. Override it by either:

> Setting the `GEMINI_MODEL` environment variable, or Providing `modelName` in the Smithery/SDK configuration schema.

## Available tools

- `analyze_image`: Analyze one or more image URLs. **Maximum file size: 16 MB per image.**
- `analyze_local_image`: Analyze one or more local images using absolute file paths. **Maximum file size: 16 MB per image.**
- `analyze_youtube_video`: Analyze a YouTube video from URL. No size limit.
- `analyze_local_video`: Analyze one or more local videos using absolute file paths. **Maximum file size: 16 MB per video.**

Image and video URLs are downloaded and processed with a 16 MB size limit to ensure fast response times. Files exceeding this limit will result in an error message indicating the actual file size.

YouTube videos are streamed directly by Gemini API without downloading, so there is no size restriction.

### Important Notes for Local Files

When using `analyze_local_image` or `analyze_local_video`, relative paths will cause path resolution issues, tested on Windows only.

**Examples:**
- ✅ **Correct**: `C:\\Users\\username\\Documents\\image.png`
- ✅ **Correct**: `/home/username/documents/image.png` (Linux/Mac)
- ❌ **Wrong**: `./image.png`
- ❌ **Wrong**: `image.png`

### Prompt examples

**URL Images:**
```
Please analyze this product photo: https://teimg-bgr.pages.dev/file/mvYT6KeF.webp
```

**Local Images:**
```
@photo.jpg Analyze this image.
```

**YouTube Videos:**
```
Extract the main talking points from this clip: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**Local Videos:**
```
@recording.mp4 Analyze this video.
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
