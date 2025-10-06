#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
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
  resolveLocalPath,
  loadServerOptions,
} from './server-config.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

loadEnvironmentVariables();

const LOCAL_VIDEO_SIZE_LIMIT_MB = 25;

const ToolNameSchema = z.enum(KNOWN_TOOL_NAMES as [ToolName, ...ToolName[]]);

function loadEnvironmentVariables(): void {
  const scriptDir = resolveScriptDirectory();
  const searchRoots = [
    process.cwd(),
    scriptDir,
    path.resolve(scriptDir, '..'),
  ];

  const tried = new Set<string>();
  let loaded = false;
  const override = shouldOverrideGeminiEnv();

  for (const root of searchRoots) {
    if (!root) {
      continue;
    }

    const envPath = path.join(root, '.env');
    if (tried.has(envPath)) {
      continue;
    }
    tried.add(envPath);

    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenvConfig({ path: envPath, override, quiet: true });
    if (result.error) {
      const error = result.error as NodeJS.ErrnoException;
      const message = error?.message ?? String(result.error);
      console.warn(`Failed to load environment variables from ${envPath}: ${message}`);
      continue;
    }

    loaded = true;
    break;
  }

  if (!loaded) {
    const fallback = dotenvConfig({ quiet: true, override });
    if (fallback.error) {
      const error = fallback.error as NodeJS.ErrnoException;
      if (error?.code !== 'ENOENT') {
        const message = error?.message ?? String(fallback.error);
        console.warn(`Failed to load environment variables via default lookup: ${message}`);
      }
    }
  }
}

function resolveScriptDirectory(): string {
  const fallback = process.cwd();

  try {
    const meta = (import.meta as ImportMeta | undefined);
    if (meta && typeof meta.url === 'string' && meta.url.length > 0) {
      return path.dirname(fileURLToPath(meta.url));
    }
  } catch (error) {
    console.warn(
      `Unable to resolve script directory from import.meta: ${error instanceof Error ? error.message : String(error)}. Falling back to process.cwd().`,
    );
  }

  return fallback;
}

function shouldOverrideGeminiEnv(): boolean {
  const current = process.env.GEMINI_API_KEY;
  if (current === undefined) {
    return true;
  }

  return current.trim().length === 0;
}

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

export function createGeminiMcpServer({ config, logger }: CreateServerArgs): McpServer {
  const geminiApiKey = (config.geminiApiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (!geminiApiKey) {
    throw new Error(
      'Gemini API key missing. Provide geminiApiKey in the Smithery configuration or set GEMINI_API_KEY in the environment.',
    );
  }

  const baseOptions = loadServerOptions(process.env);
  const modelName = config.modelName?.trim() ?? baseOptions.modelName;
  const disabledTools = mergeDisabledTools(baseOptions.disabledTools, config.disabledTools ?? []);

  const analyzer = new GeminiMediaAnalyzer(new GoogleGenerativeAI(geminiApiKey), modelName);
  const server = new McpServer({
    name: 'gemini-image-mcp-server',
    version: SERVER_VERSION,
    description: 'Analyze images and videos with Gemini API.',
  });

  const log = logger ?? console;
  log.info?.(
    `Gemini MCP server initialised (v${SERVER_VERSION}) | model=${modelName} | disabledTools=${formatDisabledTools(disabledTools)}`,
  );

  registerImageUrlTool(server, analyzer, disabledTools);
  registerImagePathTool(server, analyzer, disabledTools);
  registerVideoUrlTool(server, analyzer, disabledTools);
  registerVideoPathTool(server, analyzer, disabledTools);
  registerYouTubeTool(server, analyzer, disabledTools);

  return server;
}

export default function createServer(args: CreateServerArgs) {
  return createGeminiMcpServer(args).server;
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
) {
  server.tool(
    'analyze_image_from_path',
    'Analyzes local image files using Gemini API.',
    AnalyzeImagePathArgsSchema.shape,
    async ({ imagePaths, prompt }: z.infer<typeof AnalyzeImagePathArgsSchema>) =>
      executeTool('analyze_image_from_path', disabledTools, async () => {
        const result = readImagesFromPaths(imagePaths);
        if (result.sources.length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            buildPathFailureMessage('image', result.errors),
          );
        }
        logPartialFailures(result.errors, 'image');
        return analyzer.analyzeImages(result.sources, prompt);
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
) {
  server.tool(
    'analyze_video_from_path',
    'Analyzes local video files using Gemini API (small files recommended).',
    AnalyzeVideoPathArgsSchema.shape,
    async ({ videoPaths, prompt }: z.infer<typeof AnalyzeVideoPathArgsSchema>) =>
      executeTool('analyze_video_from_path', disabledTools, async () => {
        const result = readVideosFromPaths(videoPaths);
        if (result.sources.length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            buildPathFailureMessage('video', result.errors),
          );
        }
        logPartialFailures(result.errors, 'video');
        return analyzer.analyzeVideos(result.sources, prompt);
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

type PathReadResult<T> = {
  sources: T[];
  errors: string[];
};

function readImagesFromPaths(
  imagePaths: string[],
): PathReadResult<Base64ImageSource> {
  const sources: Base64ImageSource[] = [];
  const errors: string[] = [];

  for (const imagePath of imagePaths) {
    const outcome = toBase64ImageSource(imagePath);
    if (typeof outcome === 'string') {
      errors.push(outcome);
      continue;
    }

    if (outcome) {
      sources.push(outcome);
    }
  }

  return { sources, errors };
}

function readVideosFromPaths(
  videoPaths: string[],
): PathReadResult<Base64VideoSource> {
  const sources: Base64VideoSource[] = [];
  const errors: string[] = [];

  for (const videoPath of videoPaths) {
    const outcome = toBase64VideoSource(videoPath);
    if (typeof outcome === 'string') {
      errors.push(outcome);
      continue;
    }

    if (outcome) {
      sources.push(outcome);
    }
  }

  return { sources, errors };
}

function toBase64ImageSource(
  imagePath: string,
): Base64ImageSource | string | null {
  const resolvedPath = resolveLocalPath(imagePath);

  if (!resolvedPath) {
    console.warn(`Could not resolve local image path: ${imagePath}. Ensure the path is absolute and accessible. Skipping.`);
    return `Path could not be resolved (use an absolute path): ${imagePath}`;
  }

  if (!fs.existsSync(resolvedPath)) {
    console.warn(`Image file not found: ${resolvedPath}. Skipping.`);
    return `File not found: ${resolvedPath}`;
  }

  try {
    const stats = fs.statSync(resolvedPath);

    if (!stats.isFile()) {
      console.warn(`Path is not a regular file: ${resolvedPath}. Skipping.`);
      return `Not a regular file: ${resolvedPath}`;
    }

    const fileBuffer = fs.readFileSync(resolvedPath);
    const lookupType = mime.lookup(resolvedPath);
    const mimeType = typeof lookupType === 'string' ? lookupType : 'application/octet-stream';

    if (!mimeType.startsWith('image/')) {
      console.warn(`File is not an image: ${resolvedPath} (MIME: ${mimeType}). Skipping.`);
      return `Unsupported image MIME type (${mimeType}) at ${resolvedPath}`;
    }

    return {
      type: 'base64',
      data: fileBuffer.toString('base64'),
      mimeType,
    };
  } catch (error) {
    console.error(`Error reading image file ${resolvedPath}:`, error);
    return `Failed to read image file ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function toBase64VideoSource(
  videoPath: string,
): Base64VideoSource | string | null {
  const resolvedPath = resolveLocalPath(videoPath);

  if (!resolvedPath) {
    console.warn(`Could not resolve local video path: ${videoPath}. Ensure the path is absolute and accessible. Skipping.`);
    return `Path could not be resolved (use an absolute path): ${videoPath}`;
  }

  if (!fs.existsSync(resolvedPath)) {
    console.warn(`Video file not found: ${resolvedPath}. Skipping.`);
    return `File not found: ${resolvedPath}`;
  }

  try {
    const stats = fs.statSync(resolvedPath);

    if (!stats.isFile()) {
      console.warn(`Path is not a regular file: ${resolvedPath}. Skipping.`);
      return `Not a regular file: ${resolvedPath}`;
    }

    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > LOCAL_VIDEO_SIZE_LIMIT_MB) {
      console.warn(
        `Skipping large video (~${fileSizeMB.toFixed(2)} MB > ${LOCAL_VIDEO_SIZE_LIMIT_MB} MB limit) from ${resolvedPath}.`,
      );
      return `Video too large (~${fileSizeMB.toFixed(2)} MB) for inline upload: ${resolvedPath}`;
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
    return `Failed to read video file ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function buildPathFailureMessage(kind: 'image' | 'video', errors: string[]): string {
  if (errors.length === 0) {
    return `No valid local ${kind} files could be processed from the provided paths.`;
  }

  const uniqueErrors = Array.from(new Set(errors));
  return `No valid local ${kind} files could be processed from the provided paths. Details: ${uniqueErrors.join('; ')}`;
}

function logPartialFailures(errors: string[], kind: 'image' | 'video'): void {
  if (errors.length === 0) {
    return;
  }

  const uniqueErrors = Array.from(new Set(errors));
  for (const message of uniqueErrors) {
    console.warn(`Partial ${kind} path failure: ${message}`);
  }
}

function isExecutedDirectly(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  try {
    const resolvedEntry = path.resolve(entryPoint);
    const currentModulePath = fileURLToPath(import.meta.url);
    return resolvedEntry === currentModulePath;
  } catch {
    return false;
  }
}

async function startCliServer(): Promise<void> {
  try {
    const envApiKey = process.env.GEMINI_API_KEY?.trim();
    if (!envApiKey) {
      console.error('GEMINI_API_KEY is required when running the MCP server directly.');
      process.exit(1);
    }

    const server = createGeminiMcpServer({
      config: { geminiApiKey: envApiKey },
      logger: console,
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error('Failed to start Gemini MCP server:', error);
    process.exit(1);
  }
}

if (isExecutedDirectly()) {
  void startCliServer();
}
