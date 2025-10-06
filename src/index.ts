#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
  ServerOptions,
  isKnownToolName,
  isPathAllowed,
  resolveLocalPath,
  loadServerOptions,
} from './server-config.js';

dotenvConfig();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required in .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

type AnalyzeImageArgs = { imageUrls: string[]; prompt?: string };
type AnalyzeImagePathArgs = { imagePaths: string[]; prompt?: string };
type AnalyzeVideoArgs = { videoUrls: string[]; prompt?: string };
type AnalyzeVideoPathArgs = { videoPaths: string[]; prompt?: string };
type AnalyzeYouTubeArgs = { youtubeUrl: string; prompt?: string };

const LOCAL_VIDEO_SIZE_LIMIT_MB = 25;

class ImageAnalysisServer {
  private readonly server: Server;
  private readonly analyzer: GeminiMediaAnalyzer;
  private readonly disabledTools: Set<ToolName>;
  private readonly workspaceRoot: string;
  private readonly modelName: string;

  constructor(genAIClient: GoogleGenerativeAI, options: ServerOptions) {
    this.server = new Server({
      name: 'gemini-image-mcp-server',
      version: SERVER_VERSION,
      description: 'Analyze images and videos with Gemini API.',
    });

    this.modelName = options.modelName;
    this.disabledTools = options.disabledTools;
    this.workspaceRoot = options.workspaceRoot;
    this.analyzer = new GeminiMediaAnalyzer(genAIClient, this.modelName);

    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolDefinitions: Array<{
        name: ToolName;
        description: string;
        inputSchema: Record<string, unknown>;
      }> = [
          {
            name: 'analyze_image',
            description: 'Analyzes images available via URLs using Gemini API.',
            inputSchema: {
              type: 'object',
              properties: {
                imageUrls: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of image URLs to fetch and analyze.',
                },
                prompt: {
                  type: 'string',
                  description: 'Optional text prompt to guide the analysis output.',
                },
              },
              required: ['imageUrls'],
            },
          },
          {
            name: 'analyze_image_from_path',
            description: 'Analyzes local image files using Gemini API.',
            inputSchema: {
              type: 'object',
              properties: {
                imagePaths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of local image file paths.',
                },
                prompt: {
                  type: 'string',
                  description: 'Optional text prompt to guide the analysis output.',
                },
              },
              required: ['imagePaths'],
            },
          },
          {
            name: 'analyze_video',
            description: 'Analyzes videos accessible via URLs using Gemini API.',
            inputSchema: {
              type: 'object',
              properties: {
                videoUrls: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of video URLs (short clips recommended).',
                },
                prompt: {
                  type: 'string',
                  description: 'Optional text prompt to guide the analysis output.',
                },
              },
              required: ['videoUrls'],
            },
          },
          {
            name: 'analyze_video_from_path',
            description: 'Analyzes local video files using Gemini API (small files recommended).',
            inputSchema: {
              type: 'object',
              properties: {
                videoPaths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of local video file paths (small videos recommended).',
                },
                prompt: {
                  type: 'string',
                  description: 'Optional text prompt to guide the analysis output.',
                },
              },
              required: ['videoPaths'],
            },
          },
          {
            name: 'analyze_youtube_video',
            description: 'Analyzes a video directly from a YouTube URL using Gemini API.',
            inputSchema: {
              type: 'object',
              properties: {
                youtubeUrl: {
                  type: 'string',
                  description: 'The YouTube video URL to analyze.',
                },
                prompt: {
                  type: 'string',
                  description: 'Optional text prompt to guide the analysis output.',
                },
              },
              required: ['youtubeUrl'],
            },
          },
        ];

      const enabledTools = toolDefinitions.filter((tool) => !this.disabledTools.has(tool.name));
      return { tools: enabledTools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments;

      try {
        if (isKnownToolName(toolName) && this.disabledTools.has(toolName)) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Tool "${toolName}" is disabled by server configuration.`
          );
        }

        if (toolName === 'analyze_image') {
          if (!isAnalyzeImageArgs(args)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_image: imageUrls (array of strings) is required.'
            );
          }

          const imageSources: UrlImageSource[] = args.imageUrls.map((url) => ({
            type: 'url' as const,
            data: url,
          }));
          const analysis = await this.analyzer.analyzeImages(imageSources, args.prompt);
          return this.createSuccessResponse(analysis);
        }

        if (toolName === 'analyze_image_from_path') {
          if (!isAnalyzeImagePathArgs(args)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_image_from_path: imagePaths (array of strings) is required.'
            );
          }

          const imageSources = readImagesFromPaths(args.imagePaths, this.workspaceRoot);
          if (imageSources.length === 0) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No valid local image files could be processed from the provided paths.'
            );
          }

          const analysis = await this.analyzer.analyzeImages(imageSources, args.prompt);
          return this.createSuccessResponse(analysis);
        }

        if (toolName === 'analyze_video') {
          if (!isAnalyzeVideoArgs(args)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_video: videoUrls (array of strings) is required.'
            );
          }

          const videoSources: UrlVideoSource[] = args.videoUrls.map((url) => ({
            type: 'url' as const,
            data: url,
          }));
          const analysis = await this.analyzer.analyzeVideos(videoSources, args.prompt);
          return this.createSuccessResponse(analysis);
        }

        if (toolName === 'analyze_video_from_path') {
          if (!isAnalyzeVideoPathArgs(args)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_video_from_path: videoPaths (array of strings) is required.'
            );
          }

          const videoSources = readVideosFromPaths(args.videoPaths, this.workspaceRoot);
          if (videoSources.length === 0) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'No valid local video files could be processed from the provided paths.'
            );
          }

          const analysis = await this.analyzer.analyzeVideos(videoSources, args.prompt);
          return this.createSuccessResponse(analysis);
        }

        if (toolName === 'analyze_youtube_video') {
          if (!isAnalyzeYouTubeArgs(args)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_youtube_video: youtubeUrl (string) is required.'
            );
          }

          const videoSources: YouTubeVideoSource[] = [
            {
              type: 'youtube',
              data: args.youtubeUrl,
            },
          ];
          const analysis = await this.analyzer.analyzeVideos(videoSources, args.prompt);
          return this.createSuccessResponse(analysis);
        }

        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
      } catch (error) {
        return this.createErrorResponse(toolName, error);
      }
    });
  }

  private createSuccessResponse(text: string) {
    return {
      content: [
        {
          type: 'text' as const,
          text,
        },
      ],
    };
  }

  private createErrorResponse(toolName: string, error: unknown) {
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    const disabledList = this.disabledTools.size
      ? Array.from(this.disabledTools).sort().join(', ')
      : 'none';
    console.error(
      `Image Analysis MCP server (v${SERVER_VERSION}) running on stdio | model: ${this.modelName} | disabled tools: ${disabledList}`
    );
  }
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
        `Skipping large video (~${fileSizeMB.toFixed(2)} MB > ${LOCAL_VIDEO_SIZE_LIMIT_MB} MB limit) from ${resolvedPath}.`
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

function isAnalyzeImageArgs(value: unknown): value is AnalyzeImageArgs {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const { imageUrls, prompt } = value as AnalyzeImageArgs;
  return isStringArray(imageUrls) && isOptionalString(prompt);
}

function isAnalyzeImagePathArgs(value: unknown): value is AnalyzeImagePathArgs {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const { imagePaths, prompt } = value as AnalyzeImagePathArgs;
  return isStringArray(imagePaths) && isOptionalString(prompt);
}

function isAnalyzeVideoArgs(value: unknown): value is AnalyzeVideoArgs {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const { videoUrls, prompt } = value as AnalyzeVideoArgs;
  return isStringArray(videoUrls) && isOptionalString(prompt);
}

function isAnalyzeVideoPathArgs(value: unknown): value is AnalyzeVideoPathArgs {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const { videoPaths, prompt } = value as AnalyzeVideoPathArgs;
  return isStringArray(videoPaths) && isOptionalString(prompt);
}

function isAnalyzeYouTubeArgs(value: unknown): value is AnalyzeYouTubeArgs {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const { youtubeUrl, prompt } = value as AnalyzeYouTubeArgs;
  return typeof youtubeUrl === 'string' && youtubeUrl.trim().length > 0 && isOptionalString(prompt);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

const serverOptions = loadServerOptions(process.env);
const server = new ImageAnalysisServer(genAI, serverOptions);
server.run().catch((error) => {
  console.error('Fatal error in ImageAnalysisServer:', error);
  process.exit(1);
});
