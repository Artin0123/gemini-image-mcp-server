# image-mcp-server

[日本語の README](README.ja.md)

<a href="https://glama.ai/mcp/servers/@champierre/image-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@champierre/image-mcp-server/badge" alt="Image Analysis MCP Server" />
</a>

[![smithery badge](https://smithery.ai/badge/@champierre/image-mcp-server)](https://smithery.ai/server/@champierre/image-mcp-server)
An MCP server that receives image URLs or local file paths and analyzes image content using the Flash 2.0 model.

## Features

- Receives image URLs or local file paths as input and provides detailed analysis of the image content
- High-precision image recognition and description using the Flash 2.0 model
- Image URL validity checking
- Image loading from local files and Base64 encoding

## Installation

### Installing via Smithery

To install Image Analysis Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@champierre/image-mcp-server):

```bash
npx -y @smithery/cli install @champierre/image-mcp-server --client claude
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/champierre/image-mcp-server.git # or your forked repository
cd image-mcp-server

# Install dependencies
npm install

# Compile TypeScript
npm run build
```

## Configuration

To use this server, you need an Gemini API key. Set the following environment variable:

```
GEMINI_API_KEY=your_gemini_api_key
```

## MCP Server Configuration

To use with tools like Cline, add the following settings to your MCP server configuration file:

### For Cline

Add the following to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "image-analysis": {
      "command": "node",
      "args": ["/path/to/image-mcp-server/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key"
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
    "image-analysis": {
      "command": "node",
      "args": ["/path/to/image-mcp-server/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key"
      }
    }
  }
}
```

## Usage

Once the MCP server is configured, the following tools become available:

- `analyze_image`: Receives an image URL and analyzes its content.
- `analyze_image_from_path`: Receives a local file path and analyzes its content.

### Usage Examples

**Analyzing from URL:**

```
Please analyze this image URL: https://example.com/image.jpg
```

**Analyzing from local file path:**

```
Please analyze this image: /path/to/your/image.jpg
```

### Note: Specifying Local File Paths

When using the `analyze_image_from_path` tool, the AI assistant (client) must specify a **valid file path in the environment where this server is running**.

- **If the server is running on WSL:**
  - If the AI assistant has a Windows path (e.g., `C:\...`), it needs to convert it to a WSL path (e.g., `/mnt/c/...`) before passing it to the tool.
  - If the AI assistant has a WSL path, it can pass it as is.
- **If the server is running on Windows:**
  - If the AI assistant has a WSL path (e.g., `/home/user/...`), it needs to convert it to a UNC path (e.g., `\\wsl$\Distro\...`) before passing it to the tool.
  - If the AI assistant has a Windows path, it can pass it as is.

**Path conversion is the responsibility of the AI assistant (or its execution environment).** The server will try to interpret the received path as is.

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
```

## License

MIT
