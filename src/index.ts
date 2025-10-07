#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import {
  GeminiMediaAnalyzer,
} from './gemini-media.js';
import {
  SERVER_VERSION,
  loadServerOptions,
} from './server-config.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const TOOL_NAMES = ['analyze_image', 'analyze_video', 'analyze_youtube_video'] as const;
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
      .describe('Optional Gemini model name override. Defaults to gemini-flash-lite-latest.'),
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
      description: 'Optional Gemini model name override. Defaults to gemini-flash-lite-latest.',
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

const AnalyzeVideoInputSchema = {
  videoUrls: z
    .array(z.string().trim().url('Provide valid video URLs to analyze.'))
    .nonempty('Provide at least one video URL to analyze.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeVideoSchema = z.object(AnalyzeVideoInputSchema).strict();
type AnalyzeVideoArgs = z.infer<typeof AnalyzeVideoSchema>;

const AnalyzeYouTubeInputSchema = {
  youtubeUrl: z.string().trim().url('A valid YouTube URL is required.'),
  prompt: z.string().trim().optional(),
} satisfies z.ZodRawShape;

const AnalyzeYouTubeSchema = z.object(AnalyzeYouTubeInputSchema).strict();
type AnalyzeYouTubeArgs = z.infer<typeof AnalyzeYouTubeSchema>;

export function createGeminiMcpServer({ config, logger }: CreateServerArgs = {}): McpServer {
  const normalizedConfig = configSchema.parse(config ?? {});
  const baseOptions = loadServerOptions(process.env);
  const modelName = normalizedConfig.modelName ?? baseOptions.modelName;
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
    name: 'gemini-image-mcp-server',
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
  registerVideoUrlTool(server, getAnalyzer);
  registerYouTubeTool(server, getAnalyzer);

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
      title: 'Analyze Image (URL)',
      description: 'Analyzes images available via URLs using Gemini API.',
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

function registerVideoUrlTool(
  server: McpServer,
  getAnalyzer: () => GeminiMediaAnalyzer,
) {
  server.registerTool(
    'analyze_video',
    {
      title: 'Analyze Video (URL)',
      description: 'Analyzes videos accessible via URLs using Gemini API.',
      inputSchema: AnalyzeVideoSchema.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (rawArgs: unknown) =>
      executeTool('analyze_video', async () => {
        const { videoUrls, prompt } = AnalyzeVideoSchema.parse(rawArgs);
        const analyzer = getAnalyzer();
        return analyzer.analyzeVideoUrls(videoUrls, prompt);
      }),
  );
}

function registerYouTubeTool(
  server: McpServer,
  getAnalyzer: () => GeminiMediaAnalyzer,
) {
  server.registerTool(
    'analyze_youtube_video',
    {
      title: 'Analyze YouTube Video',
      description: 'Analyzes a video directly from a YouTube URL using Gemini API.',
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
