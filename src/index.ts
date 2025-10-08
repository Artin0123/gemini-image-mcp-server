#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  GeminiMediaAnalyzer,
} from './gemini-media.js';
import {
  SERVER_VERSION,
  loadServerOptions,
  normalizeModelName,
} from './server-config.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const TOOL_NAMES = ['analyze_image', 'analyze_youtube_video', 'analyze_local_image', 'analyze_local_video'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

export const configSchema = z
  .object({
    geminiApiKey: z
      .string()
      .trim()
      .min(1, 'A Gemini API key is required to connect to Google Gemini.')
      .optional()
      .describe(
        'Your Google Gemini API key for image and video analysis. Falls back to GEMINI_API_KEY when omitted.',
      ),
    modelName: z
      .string()
      .trim()
      .min(1, 'Model name cannot be empty.')
      .optional()
      .describe(
        'Optional Gemini model name override. Defaults to models/gemini-flash-lite-latest.',
      ),
  })
  .passthrough();

const configJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    geminiApiKey: {
      type: 'string',
      description:
        'Your Google Gemini API key for image and video analysis. Falls back to GEMINI_API_KEY when omitted.',
    },
    modelName: {
      type: 'string',
      description: 'Optional Gemini model name override. Defaults to models/gemini-flash-lite-latest.',
    },
  },
  required: [],
} as const;

type Config = z.infer<typeof configSchema>;

type Logger = {
  info?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
};

type CreateServerArgs = {
  config?: unknown;
  logger?: Logger;
};

const AnalyzeImageInputSchema = {
  imageUrls: z
    .array(z.string().trim().url('Provide valid image URLs to analyze.'))
    .nonempty('Provide at least one image URL to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeImageSchema = z.object(AnalyzeImageInputSchema).strict();
type AnalyzeImageArgs = z.infer<typeof AnalyzeImageSchema>;

const AnalyzeYouTubeInputSchema = {
  youtubeUrl: z.string().trim().url('A valid YouTube URL is required.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeYouTubeSchema = z.object(AnalyzeYouTubeInputSchema).strict();
type AnalyzeYouTubeArgs = z.infer<typeof AnalyzeYouTubeSchema>;

const AnalyzeLocalImageInputSchema = {
  imagePaths: z
    .array(z.string().trim().min(1, 'Image path cannot be empty.'))
    .nonempty('Provide at least one absolute image path to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeLocalImageSchema = z.object(AnalyzeLocalImageInputSchema).strict();
type AnalyzeLocalImageArgs = z.infer<typeof AnalyzeLocalImageSchema>;

const AnalyzeLocalVideoInputSchema = {
  videoPaths: z
    .array(z.string().trim().min(1, 'Video path cannot be empty.'))
    .nonempty('Provide at least one absolute video path to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeLocalVideoSchema = z.object(AnalyzeLocalVideoInputSchema).strict();
type AnalyzeLocalVideoArgs = z.infer<typeof AnalyzeLocalVideoSchema>;

export function createGeminiMcpServer({ config, logger }: CreateServerArgs = {}): McpServer {
  const normalizedConfig = configSchema.parse(config ?? {});
  const baseOptions = loadServerOptions(process.env);
  const modelName =
    normalizedConfig.modelName !== undefined
      ? normalizeModelName(normalizedConfig.modelName)
      : baseOptions.modelName;
  const resolveGeminiApiKey = () =>
    normalizedConfig.geminiApiKey ?? process.env.GEMINI_API_KEY?.trim();

  let analyzer: GeminiMediaAnalyzer | null = null;
  const getAnalyzer = () => {
    if (analyzer) {
      return analyzer;
    }

    const geminiApiKey = resolveGeminiApiKey();
    if (!geminiApiKey) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Gemini API key missing. Provide geminiApiKey in the Smithery configuration or set GEMINI_API_KEY in the environment.',
      );
    }

    analyzer = new GeminiMediaAnalyzer(new GoogleGenAI({ apiKey: geminiApiKey }), modelName);
    return analyzer;
  };
  const server = new McpServer({
    name: 'gemini-vision-mcp',
    version: SERVER_VERSION,
    description: 'Analyze images and videos with Gemini API.',
    configuration: {
      schema: configJsonSchema,
    },
  });

  const log = logger ?? console;
  log.info?.(
    `Gemini MCP server initialised (v${SERVER_VERSION}) | model=${modelName}`,
  );

  registerImageUrlTool(server, getAnalyzer);
  registerYouTubeVideoTool(server, getAnalyzer);
  registerLocalImageTool(server, getAnalyzer);
  registerLocalVideoTool(server, getAnalyzer);

  return server;
}

export default function createServer(args: CreateServerArgs = {}) {
  return createGeminiMcpServer(args).server;
}

function registerImageUrlTool(
  server: McpServer,
  getAnalyzer: () => GeminiMediaAnalyzer,
) {
  server.registerTool(
    'analyze_image',
    {
      title: 'Analyze URL Image',
      description: 'Analyzes images available via URLs using Gemini API. Maximum file size: 16 MB.',
      inputSchema: AnalyzeImageSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (rawArgs: unknown) =>
      executeTool('analyze_image', async () => {
        const { imageUrls, prompt } = AnalyzeImageSchema.parse(rawArgs);
        const analyzer = getAnalyzer();
        return analyzer.analyzeImageUrls(imageUrls, prompt);
      }),
  );
}

function registerYouTubeVideoTool(
  server: McpServer,
  getAnalyzer: () => GeminiMediaAnalyzer,
) {
  server.registerTool(
    'analyze_youtube_video',
    {
      title: 'Analyze YouTube Video',
      description: 'Analyzes a YouTube video from URL using Gemini API. No size limit.',
      inputSchema: AnalyzeYouTubeSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (rawArgs: unknown) =>
      executeTool('analyze_youtube_video', async () => {
        const { youtubeUrl, prompt } = AnalyzeYouTubeSchema.parse(rawArgs);
        const analyzer = getAnalyzer();
        return analyzer.analyzeYouTubeVideo(youtubeUrl, prompt);
      }),
  );
}

function registerLocalImageTool(
  server: McpServer,
  getAnalyzer: () => GeminiMediaAnalyzer,
) {
  server.registerTool(
    'analyze_local_image',
    {
      title: 'Analyze Local Image',
      description: 'Analyzes local images using absolute file paths. Maximum file size: 16 MB per image. IMPORTANT: Paths must be absolute (e.g., C:\\Users\\username\\image.png).',
      inputSchema: AnalyzeLocalImageSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (rawArgs: unknown) =>
      executeTool('analyze_local_image', async () => {
        const { imagePaths, prompt } = AnalyzeLocalImageSchema.parse(rawArgs);
        const analyzer = getAnalyzer();
        return analyzer.analyzeLocalImages(imagePaths, prompt);
      }),
  );
}

function registerLocalVideoTool(
  server: McpServer,
  getAnalyzer: () => GeminiMediaAnalyzer,
) {
  server.registerTool(
    'analyze_local_video',
    {
      title: 'Analyze Local Video',
      description: 'Analyzes local videos using absolute file paths. Maximum file size: 16 MB per video. IMPORTANT: Paths must be absolute (e.g., C:\\Users\\username\\video.mp4).',
      inputSchema: AnalyzeLocalVideoSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (rawArgs: unknown) =>
      executeTool('analyze_local_video', async () => {
        const { videoPaths, prompt } = AnalyzeLocalVideoSchema.parse(rawArgs);
        const analyzer = getAnalyzer();
        return analyzer.analyzeLocalVideos(videoPaths, prompt);
      }),
  );
}

async function executeTool(
  toolName: ToolName,
  executor: () => Promise<string>,
) {
  try {
    const text = await executor();
    return createSuccessResponse(text);
  } catch (error) {
    return createErrorResponse(toolName, error);
  }
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
