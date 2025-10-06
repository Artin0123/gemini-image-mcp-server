#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  GeminiMediaAnalyzer,
  UrlImageSource,
  LocalImageSource,
  UrlVideoSource,
  LocalVideoSource,
  YouTubeVideoSource,
} from './gemini-media.js';
import {
  SERVER_VERSION,
  ToolName,
  KNOWN_TOOL_NAMES,
  isKnownToolName,
  loadServerOptions,
} from './server-config.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

loadEnvironmentVariables();

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

const AnalyzeImageParamsSchema = {
  imageUrls: z
    .array(z.string().trim().min(1))
    .nonempty('Provide at least one image URL to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeImageArgsSchema = z.object(AnalyzeImageParamsSchema);

const LocalFileInputParamsSchema = {
  path: z.string().trim().min(1, 'Provide a local file path.'),
  mimeType: z.string().trim().optional(),
  displayName: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const LocalFileInputSchema = z.object(LocalFileInputParamsSchema);

const AnalyzeImageLocalParamsSchema = {
  images: z
    .array(LocalFileInputSchema)
    .nonempty('Provide at least one local image file to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeImageLocalArgsSchema = z.object(AnalyzeImageLocalParamsSchema);

const AnalyzeVideoParamsSchema = {
  videoUrls: z
    .array(z.string().trim().min(1))
    .nonempty('Provide at least one video URL to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeVideoArgsSchema = z.object(AnalyzeVideoParamsSchema);

const AnalyzeVideoLocalParamsSchema = {
  videos: z
    .array(LocalFileInputSchema)
    .nonempty('Provide at least one local video file to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeVideoLocalArgsSchema = z.object(AnalyzeVideoLocalParamsSchema);

const AnalyzeYouTubeParamsSchema = {
  youtubeUrl: z.string().trim().min(1, 'A YouTube URL is required.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeYouTubeArgsSchema = z.object(AnalyzeYouTubeParamsSchema);

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

  const analyzer = new GeminiMediaAnalyzer(new GoogleGenAI({ apiKey: geminiApiKey }), modelName);
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
  registerImageLocalTool(server, analyzer, disabledTools);
  registerVideoUrlTool(server, analyzer, disabledTools);
  registerVideoLocalTool(server, analyzer, disabledTools);
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
  server
    .tool(
      'analyze_image',
      {
        title: 'Analyze Image (URL)',
        description: 'Analyzes images available via URLs using Gemini API.',
        readOnlyHint: true,
        idempotentHint: true,
      },
      async (args) =>
        executeTool('analyze_image', disabledTools, async () => {
          const { imageUrls, prompt } = AnalyzeImageArgsSchema.parse(args);
          const imageSources: UrlImageSource[] = imageUrls.map((url) => ({
            type: 'url' as const,
            data: url,
          }));
          return analyzer.analyzeImages(imageSources, prompt);
        }),
    )
    .update({
      paramsSchema: AnalyzeImageParamsSchema as any,
    });
}

function registerImageLocalTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
) {
  server
    .tool(
      'analyze_image_local',
      {
        title: 'Analyze Image (Local)',
        description: 'Analyzes local image files by uploading them with the Gemini Files API.',
        readOnlyHint: true,
        idempotentHint: true,
      },
      async (args) =>
        executeTool('analyze_image_local', disabledTools, async () => {
          const { images, prompt } = AnalyzeImageLocalArgsSchema.parse(args);
          const imageSources: LocalImageSource[] = images.map((entry) => ({
            type: 'local',
            data: entry.path,
            mimeType: entry.mimeType,
          }));
          return analyzer.analyzeImages(imageSources, prompt);
        }),
    )
    .update({
      paramsSchema: AnalyzeImageLocalParamsSchema as any,
    });
}

function registerVideoUrlTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
) {
  server
    .tool(
      'analyze_video',
      {
        title: 'Analyze Video (URL)',
        description: 'Analyzes videos accessible via URLs using Gemini API.',
        readOnlyHint: true,
        idempotentHint: true,
      },
      async (args) =>
        executeTool('analyze_video', disabledTools, async () => {
          const { videoUrls, prompt } = AnalyzeVideoArgsSchema.parse(args);
          const videoSources: UrlVideoSource[] = videoUrls.map((url) => ({
            type: 'url' as const,
            data: url,
          }));
          return analyzer.analyzeVideos(videoSources, prompt);
        }),
    )
    .update({
      paramsSchema: AnalyzeVideoParamsSchema as any,
    });
}

function registerVideoLocalTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
) {
  server
    .tool(
      'analyze_video_local',
      {
        title: 'Analyze Video (Local)',
        description: 'Analyzes local video files by uploading them with the Gemini Files API.',
        readOnlyHint: true,
        idempotentHint: true,
      },
      async (args) =>
        executeTool('analyze_video_local', disabledTools, async () => {
          const { videos, prompt } = AnalyzeVideoLocalArgsSchema.parse(args);
          const videoSources: LocalVideoSource[] = videos.map((entry) => ({
            type: 'local',
            data: entry.path,
            mimeType: entry.mimeType,
          }));
          return analyzer.analyzeVideos(videoSources, prompt);
        }),
    )
    .update({
      paramsSchema: AnalyzeVideoLocalParamsSchema as any,
    });
}

function registerYouTubeTool(
  server: McpServer,
  analyzer: GeminiMediaAnalyzer,
  disabledTools: Set<ToolName>,
) {
  server
    .tool(
      'analyze_youtube_video',
      {
        title: 'Analyze YouTube Video',
        description: 'Analyzes a video directly from a YouTube URL using Gemini API.',
        readOnlyHint: true,
        idempotentHint: true,
      },
      async (args) =>
        executeTool('analyze_youtube_video', disabledTools, async () => {
          const { youtubeUrl, prompt } = AnalyzeYouTubeArgsSchema.parse(args);
          const videoSources: YouTubeVideoSource[] = [
            {
              type: 'youtube',
              data: youtubeUrl,
            },
          ];
          return analyzer.analyzeVideos(videoSources, prompt);
        }),
    )
    .update({
      paramsSchema: AnalyzeYouTubeParamsSchema as any,
    });
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
