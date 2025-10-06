#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as mime from 'mime-types';
import {
  GeminiMediaAnalyzer,
  UrlImageSource,
  Base64ImageSource,
  UrlVideoSource,
  Base64VideoSource,
  YouTubeVideoSource,
} from './gemini-media.js';
import {
  SERVER_VERSION,
  ToolName,
  KNOWN_TOOL_NAMES,
  isKnownToolName,
  isPathAllowed,
  resolveLocalPath,
  loadServerOptions,
} from './server-config.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

dotenvConfig();

const LOCAL_VIDEO_SIZE_LIMIT_MB = 25;

const ToolNameSchema = z.enum(KNOWN_TOOL_NAMES as [ToolName, ...ToolName[]]);

export const configSchema = z.object({
  geminiApiKey: z
    .string()
    .min(1, 'A Gemini API key is required to connect to Google Gemini.')
    .describe('Your Google Gemini API key for image and video analysis.'),
  modelName: z
    .string()
    .trim()
    .min(1, 'Model name cannot be empty.')
    .optional()
    .describe('Optional Gemini model name override. Defaults to gemini-flash-lite-latest.'),
  disabledTools: z
    .array(ToolNameSchema)
    .optional()
    .describe('Optional list of tool names to disable (e.g., analyze_video).'),
});

type Config = z.infer<typeof configSchema>;

type Logger = {
  info?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
};

type CreateServerArgs = {
  config: Config;
  logger?: Logger;
};

const AnalyzeImageArgsSchema = z.object({
  imageUrls: z
    .array(z.string().trim().min(1))
    .nonempty('Provide at least one image URL to analyze.'),
  prompt: z.string().trim().optional(),
});

const AnalyzeImagePathArgsSchema = z.object({
  imagePaths: z
    .array(z.string().trim().min(1))
    .nonempty('Provide at least one local image path to analyze.'),
  prompt: z.string().trim().optional(),
});

const AnalyzeVideoArgsSchema = z.object({
  videoUrls: z
    .array(z.string().trim().min(1))
    .nonempty('Provide at least one video URL to analyze.'),
  prompt: z.string().trim().optional(),
});

const AnalyzeVideoPathArgsSchema = z.object({
  videoPaths: z
    .array(z.string().trim().min(1))
    .nonempty('Provide at least one local video path to analyze.'),
  prompt: z.string().trim().optional(),
});

const AnalyzeYouTubeArgsSchema = z.object({
  youtubeUrl: z.string().trim().min(1, 'A YouTube URL is required.'),
  prompt: z.string().trim().optional(),
});

export default function createServer({ config, logger }: CreateServerArgs) {
  const geminiApiKey = (config.geminiApiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (!geminiApiKey) {
    throw new Error(
      'Gemini API key missing. Provide geminiApiKey in the Smithery configuration or set GEMINI_API_KEY in the environment.',
    );
  }

  const baseOptions = loadServerOptions(process.env);
  const modelName = config.modelName?.trim() ?? baseOptions.modelName;
  const disabledTools = mergeDisabledTools(baseOptions.disabledTools, config.disabledTools ?? []);
  const workspaceRoot = baseOptions.workspaceRoot;

  const analyzer = new GeminiMediaAnalyzer(new GoogleGenerativeAI(geminiApiKey), modelName);
  const server = new McpServer({
    name: 'gemini-image-mcp-server',
    version: SERVER_VERSION,
    description: 'Analyze images and videos with Gemini API.',
  });

  const log = logger ?? console;
  log.info?.(
    `Gemini MCP server initialised (v${SERVER_VERSION}) | model=${modelName} | disabledTools=${formatDisabledTools(disabledTools)} | workspaceRoot=${workspaceRoot}`,
  );

  registerImageUrlTool(server, analyzer, disabledTools);
  registerImagePathTool(server, analyzer, disabledTools, workspaceRoot);
  registerVideoUrlTool(server, analyzer, disabledTools);
  registerVideoPathTool(server, analyzer, disabledTools, workspaceRoot);
  registerYouTubeTool(server, analyzer, disabledTools);

  return server.server;
}

function registerImageUrlTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
) {
  server.tool(
    'analyze_image',
    'Analyzes images available via URLs using Gemini API.',
    AnalyzeImageArgsSchema.shape,
    async ({ imageUrls, prompt }: z.infer<typeof AnalyzeImageArgsSchema>) =>
      executeTool('analyze_image', disabledTools, async () => {
        const imageSources: UrlImageSource[] = imageUrls.map((url) => ({
          type: 'url' as const,
          data: url,
        }));
        return analyzer.analyzeImages(imageSources, prompt);
      }),
  );
}

function registerImagePathTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
  workspaceRoot: string,
) {
  server.tool(
    'analyze_image_from_path',
    'Analyzes local image files using Gemini API.',
    AnalyzeImagePathArgsSchema.shape,
    async ({ imagePaths, prompt }: z.infer<typeof AnalyzeImagePathArgsSchema>) =>
      executeTool('analyze_image_from_path', disabledTools, async () => {
        const imageSources = readImagesFromPaths(imagePaths, workspaceRoot);
        if (imageSources.length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'No valid local image files could be processed from the provided paths.',
          );
        }
        return analyzer.analyzeImages(imageSources, prompt);
      }),
  );
}

function registerVideoUrlTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
) {
  server.tool(
    'analyze_video',
    'Analyzes videos accessible via URLs using Gemini API.',
    AnalyzeVideoArgsSchema.shape,
    async ({ videoUrls, prompt }: z.infer<typeof AnalyzeVideoArgsSchema>) =>
      executeTool('analyze_video', disabledTools, async () => {
        const videoSources: UrlVideoSource[] = videoUrls.map((url) => ({
          type: 'url' as const,
          data: url,
        }));
        return analyzer.analyzeVideos(videoSources, prompt);
      }),
  );
}

function registerVideoPathTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
  workspaceRoot: string,
) {
  server.tool(
    'analyze_video_from_path',
    'Analyzes local video files using Gemini API (small files recommended).',
    AnalyzeVideoPathArgsSchema.shape,
    async ({ videoPaths, prompt }: z.infer<typeof AnalyzeVideoPathArgsSchema>) =>
      executeTool('analyze_video_from_path', disabledTools, async () => {
        const videoSources = readVideosFromPaths(videoPaths, workspaceRoot);
        if (videoSources.length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'No valid local video files could be processed from the provided paths.',
          );
        }
        return analyzer.analyzeVideos(videoSources, prompt);
      }),
  );
}

function registerYouTubeTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
) {
  server.tool(
    'analyze_youtube_video',
    'Analyzes a video directly from a YouTube URL using Gemini API.',
    AnalyzeYouTubeArgsSchema.shape,
    async ({ youtubeUrl, prompt }: z.infer<typeof AnalyzeYouTubeArgsSchema>) =>
      executeTool('analyze_youtube_video', disabledTools, async () => {
        const videoSources: YouTubeVideoSource[] = [
          {
            type: 'youtube',
            data: youtubeUrl,
          },
        ];
        return analyzer.analyzeVideos(videoSources, prompt);
      }),
  );
}

async function executeTool(
  toolName: ToolName,
  disabledTools: Set<ToolName>,
  executor: () => Promise<string>,
) {
  if (disabledTools.has(toolName)) {
    return createErrorResponse(
      toolName,
      new McpError(ErrorCode.InvalidRequest, `Tool "${toolName}" is disabled by server configuration.`),
    );
  }

  try {
    const text = await executor();
    return createSuccessResponse(text);
  } catch (error) {
    return createErrorResponse(toolName, error);
  }
}

function mergeDisabledTools(
  envDisabled: Set<ToolName>,
  configDisabled: ToolName[],
): Set<ToolName> {
  const merged = new Set(envDisabled);
  for (const name of configDisabled) {
    if (isKnownToolName(name)) {
      merged.add(name);
    }
  }
  return merged;
}

function formatDisabledTools(disabledTools: Set<ToolName>): string {
  if (!disabledTools.size) {
    return 'none';
  }
  return Array.from(disabledTools).sort().join(',');
}

function createSuccessResponse(text: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}

function createErrorResponse(toolName: ToolName, error: unknown) {
  console.error(`Error calling tool ${toolName}:`, error);
  const message =
    error instanceof McpError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);

  return {
    content: [
      {
        type: 'text' as const,
        text: `Tool execution error (${toolName}): ${message}`,
      },
    ],
    isError: true as const,
    errorCode: error instanceof McpError ? error.code : ErrorCode.InternalError,
  };
}

function readImagesFromPaths(imagePaths: string[], workspaceRoot: string): Base64ImageSource[] {
  const sources: Base64ImageSource[] = [];

  for (const imagePath of imagePaths) {
    const source = toBase64ImageSource(imagePath, workspaceRoot);
    if (source) {
      sources.push(source);
    }
  }

  return sources;
}

function readVideosFromPaths(videoPaths: string[], workspaceRoot: string): Base64VideoSource[] {
  const sources: Base64VideoSource[] = [];

  for (const videoPath of videoPaths) {
    const source = toBase64VideoSource(videoPath, workspaceRoot);
    if (source) {
      sources.push(source);
    }
  }

  return sources;
}

function toBase64ImageSource(imagePath: string, workspaceRoot: string): Base64ImageSource | null {
  const resolvedPath = resolveLocalPath(imagePath);

  if (!resolvedPath) {
    console.warn(`Could not resolve local image path: ${imagePath}. Skipping.`);
    return null;
  }

  if (!isPathAllowed(resolvedPath, workspaceRoot)) {
    console.warn(`Blocking access to disallowed path: ${resolvedPath}`);
    return null;
  }

  if (!fs.existsSync(resolvedPath)) {
    console.warn(`Image file not found: ${resolvedPath}. Skipping.`);
    return null;
  }

  try {
    const stats = fs.statSync(resolvedPath);

    if (!stats.isFile()) {
      console.warn(`Path is not a regular file: ${resolvedPath}. Skipping.`);
      return null;
    }

    const fileBuffer = fs.readFileSync(resolvedPath);
    const lookupType = mime.lookup(resolvedPath);
    const mimeType = typeof lookupType === 'string' ? lookupType : 'application/octet-stream';

    if (!mimeType.startsWith('image/')) {
      console.warn(`File is not an image: ${resolvedPath} (MIME: ${mimeType}). Skipping.`);
      return null;
    }

    return {
      type: 'base64',
      data: fileBuffer.toString('base64'),
      mimeType,
    };
  } catch (error) {
    console.error(`Error reading image file ${resolvedPath}:`, error);
    return null;
  }
}

function toBase64VideoSource(videoPath: string, workspaceRoot: string): Base64VideoSource | null {
  const resolvedPath = resolveLocalPath(videoPath);

  if (!resolvedPath) {
    console.warn(`Could not resolve local video path: ${videoPath}. Skipping.`);
    return null;
  }

  if (!isPathAllowed(resolvedPath, workspaceRoot)) {
    console.warn(`Blocking access to disallowed path: ${resolvedPath}`);
    return null;
  }

  if (!fs.existsSync(resolvedPath)) {
    console.warn(`Video file not found: ${resolvedPath}. Skipping.`);
    return null;
  }

  try {
    const stats = fs.statSync(resolvedPath);

    if (!stats.isFile()) {
      console.warn(`Path is not a regular file: ${resolvedPath}. Skipping.`);
      return null;
    }

    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > LOCAL_VIDEO_SIZE_LIMIT_MB) {
      console.warn(
        `Skipping large video (~${fileSizeMB.toFixed(2)} MB > ${LOCAL_VIDEO_SIZE_LIMIT_MB} MB limit) from ${resolvedPath}.`,
      );
      return null;
    }

    const fileBuffer = fs.readFileSync(resolvedPath);
    const lookupType = mime.lookup(resolvedPath);
    const mimeType = typeof lookupType === 'string' ? lookupType : 'application/octet-stream';

    return {
      type: 'base64',
      data: fileBuffer.toString('base64'),
      mimeType,
    };
  } catch (error) {
    console.error(`Error reading video file ${resolvedPath}:`, error);
    return null;
  }
}
