#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleGenerativeAI, Content, Part } from "@google/generative-ai"; // Added Content, Part
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs'; // Import fs for file reading
import * as path from 'path'; // Import path for path operations
import * as os from 'os'; // Import os module
import * as mime from 'mime-types'; // Revert to import statement

// Load environment variables from .env file
dotenv.config();

// Get Gemini API key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

// Initialize Google GenAI client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- Argument Type Guards ---
const isValidAnalyzeImageArgs = (
  args: any
): args is { imageUrls: string[] } => // Changed to imageUrls (array)
  typeof args === 'object' &&
  args !== null &&
  Array.isArray(args.imageUrls) &&
  args.imageUrls.every((item: any) => typeof item === 'string');

const isValidAnalyzeImagePathArgs = (
  args: any
): args is { imagePaths: string[] } => // Changed to imagePaths (array)
  typeof args === 'object' &&
  args !== null &&
  Array.isArray(args.imagePaths) &&
  args.imagePaths.every((item: any) => typeof item === 'string');
// --- End Argument Type Guards ---

// --- Video Type Guards ---
const isValidAnalyzeVideoArgs = (
  args: any
): args is { videoUrls: string[], prompt?: string } =>
  typeof args === 'object' &&
  args !== null &&
  Array.isArray(args.videoUrls) &&
  args.videoUrls.every((item: any) => typeof item === 'string') &&
  (args.prompt === undefined || typeof args.prompt === 'string');

const isValidAnalyzeVideoPathArgs = (
  args: any
): args is { videoPaths: string[], prompt?: string } =>
  typeof args === 'object' &&
  args !== null &&
  Array.isArray(args.videoPaths) &&
  args.videoPaths.every((item: any) => typeof item === 'string') &&
  (args.prompt === undefined || typeof args.prompt === 'string');

// Modified type guard for single YouTube URL
const isValidAnalyzeYouTubeArg = (
  args: any
): args is { youtubeUrl: string, prompt?: string } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.youtubeUrl === 'string' && // Check for single string
  (args.prompt === undefined || typeof args.prompt === 'string');
// --- End Video Type Guards ---

class ImageAnalysisServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'image-analysis-server',
        version: '1.1.0', // Version bump
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // Define tool list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'analyze_image',
          description: 'Receives one or more image URLs and analyzes the image contents using Flash 2.0. Can analyze relationships between multiple images.',
          inputSchema: {
            type: 'object',
            properties: {
              imageUrls: { // Changed to imageUrls
                type: 'array',
                items: { type: 'string' },
                description: 'An array of URLs for the images to analyze',
              },
              // Optional: Add a text prompt parameter if desired
              // prompt: {
              //   type: 'string',
              //   description: 'Optional text prompt to guide the analysis (e.g., "Compare these images")',
              //   default: 'Analyze the image content in detail and provide an explanation in English.'
              // }
            },
            required: ['imageUrls'], // Changed to imageUrls
          },
        },
        // --- Tool Definition for Paths ---
        {
          name: 'analyze_image_from_path',
          description: 'Loads one or more images from local file paths and analyzes their contents using Flash 2.0. Can analyze relationships between multiple images. Provide valid paths for the server environment.',
          inputSchema: {
            type: 'object',
            properties: {
              imagePaths: { // Changed to imagePaths
                type: 'array',
                items: { type: 'string' },
                description: 'An array of local file paths for the images to analyze (must be accessible from the server)',
              },
               // Optional: Add a text prompt parameter if desired
              // prompt: {
              //   type: 'string',
              //   description: 'Optional text prompt to guide the analysis (e.g., "Which image contains a car?")',
              //   default: 'Analyze the image content in detail and provide an explanation in English.'
              // }
            },
            required: ['imagePaths'], // Changed to imagePaths
          },
        },
        // --- End Tool Definition for Paths ---
        // --- Video Tool Definitions ---
        {
          name: 'analyze_video',
          description: 'Downloads videos from URLs, analyzes content using Gemini 2.0 Flash. Best for small videos (<20MB). Can analyze multiple videos together.',
          inputSchema: {
            type: 'object',
            properties: {
              videoUrls: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of video URLs to analyze (small videos recommended).',
              },
              prompt: {
                type: 'string',
                description: 'Optional text prompt (e.g., "Summarize this video.")',
              },
            },
            required: ['videoUrls'],
          },
        },
        {
          name: 'analyze_video_from_path',
            description: 'Loads videos from local paths, analyzes content using Gemini 2.0 Flash. Best for small videos (<20MB). Can analyze multiple videos together.',
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
                description: 'Optional text prompt (e.g., "What happens at 0:15?")',
              },
            },
            required: ['videoPaths'],
          },
        },
        {
          name: 'analyze_youtube_video',
            description: 'Analyzes a video directly from a YouTube URL using Gemini 2.0 Flash.', // Updated description
          inputSchema: {
            type: 'object',
            properties: {
              youtubeUrl: { // Changed from youtubeUrls (array) to youtubeUrl (string)
                type: 'string',
                description: 'The YouTube video URL to analyze.', // Updated description
              },
              prompt: {
                type: 'string',
                description: 'Optional text prompt (e.g., "Summarize this video.")',
              },
            },
            required: ['youtubeUrl'], // Changed required field
          },
        },
        // --- End Video Tool Definitions ---
      ],
    }));

    // Tool execution handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments;

      try {
        let analysis: string;
        // Extract the prompt generically - assumes 'prompt' key if present
        const customPrompt = typeof args === 'object' && args !== null && typeof args.prompt === 'string' ? args.prompt : undefined;

        if (toolName === 'analyze_image') {
          if (!isValidAnalyzeImageArgs(args)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_image: imageUrls (array of strings) is required'
            );
          }
          const imageUrls = args.imageUrls;
          const imageSources = imageUrls.map(url => ({ type: 'url' as const, data: url }));
          // Pass prompt if needed, otherwise analyzeImageWithGemini uses its default
          analysis = await this.analyzeImageWithGemini(imageSources, customPrompt);

        } else if (toolName === 'analyze_image_from_path') {
          if (!isValidAnalyzeImagePathArgs(args)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_image_from_path: imagePaths (array of strings) is required'
            );
          }
          const imagePaths = args.imagePaths;
          const imageSources: Array<{ type: 'base64', data: string, mimeType: string }> = [];

          for (const imagePath of imagePaths) {
            // Basic security check (consider enhancing)
            if (path.isAbsolute(imagePath) && !imagePath.startsWith(process.cwd()) && !imagePath.startsWith(os.homedir()) && !imagePath.startsWith('/mnt/')) {
              console.warn(`Potential unsafe path access attempt blocked: ${imagePath}`);
              // Skip this path or throw error depending on desired behavior
              continue; // Skip potentially unsafe path
            }

            const resolvedPath = path.resolve(imagePath);
            if (!fs.existsSync(resolvedPath)) {
               console.warn(`File not found at path: ${resolvedPath}. Skipping.`);
               continue; // Skip non-existent file
            }

            try {
                const imageDataBuffer = fs.readFileSync(resolvedPath);
                const base64String = imageDataBuffer.toString('base64');
                const mimeType = mime.lookup(resolvedPath) || 'application/octet-stream';

                if (!mimeType.startsWith('image/')) {
                    console.warn(`File is not an image: ${resolvedPath} (MIME: ${mimeType}). Skipping.`);
                    continue; // Skip non-image file
                }
                imageSources.push({ type: 'base64' as const, data: base64String, mimeType: mimeType });
             } catch (readError) {
                 console.error(`Error reading file ${resolvedPath}:`, readError);
                 // Skip this file on read error
                 continue;
             }
          } // End for loop

          if (imageSources.length === 0) {
               throw new McpError(ErrorCode.InvalidParams, 'No valid local image files could be processed from the provided paths.');
          }

          // Pass prompt if needed
          analysis = await this.analyzeImageWithGemini(imageSources, customPrompt);

        } else if (toolName === 'analyze_video') {
            if (!isValidAnalyzeVideoArgs(args)) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    'Invalid arguments for analyze_video: videoUrls (array of strings) is required, prompt (string) is optional.'
                );
            }
            const videoUrls = args.videoUrls;
            const videoSources = videoUrls.map(url => ({ type: 'url' as const, data: url }));
            analysis = await this.analyzeVideoWithGemini(videoSources, customPrompt);

        } else if (toolName === 'analyze_video_from_path') {
            if (!isValidAnalyzeVideoPathArgs(args)) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    'Invalid arguments for analyze_video_from_path: videoPaths (array of strings) is required, prompt (string) is optional.'
                );
            }
            const videoPaths = args.videoPaths;
            const videoSources: Array<{ type: 'base64', data: string, mimeType: string }> = [];

            for (const videoPath of videoPaths) {
                // Basic security check
                if (path.isAbsolute(videoPath) && !videoPath.startsWith(process.cwd()) && !videoPath.startsWith(os.homedir()) && !videoPath.startsWith('/mnt/')) {
                    console.warn(`Potential unsafe path access attempt blocked: ${videoPath}`);
                    continue;
                }
                const resolvedPath = path.resolve(videoPath);
                if (!fs.existsSync(resolvedPath)) {
                    console.warn(`Video file not found: ${resolvedPath}. Skipping.`);
                    continue;
                }
                try {
                    const videoDataBuffer = fs.readFileSync(resolvedPath);
                    // Consider adding a size check here before reading whole file for large videos
                    const base64String = videoDataBuffer.toString('base64');
                    const mimeType = mime.lookup(resolvedPath) || 'application/octet-stream';
                    // Mime type check happens within analyzeVideoWithGemini
                     videoSources.push({ type: 'base64' as const, data: base64String, mimeType: mimeType });
                } catch (readError) {
                    console.error(`Error reading video file ${resolvedPath}:`, readError);
                    continue;
                }
            }
            if (videoSources.length === 0) {
                throw new McpError(ErrorCode.InvalidParams, 'No valid local video files could be processed.');
            }
            analysis = await this.analyzeVideoWithGemini(videoSources, customPrompt);

        } else if (toolName === 'analyze_youtube_video') {
             if (!isValidAnalyzeYouTubeArg(args)) { // Use updated type guard
                throw new McpError(
                    ErrorCode.InvalidParams,
                    'Invalid arguments for analyze_youtube_video: youtubeUrl (string) is required, prompt (string) is optional.' // Updated error message
                );
            }
            const youtubeUrl = args.youtubeUrl; // Get single URL
            // Pass a single-element array to analyzeVideoWithGemini
            const videoSources = [{ type: 'youtube' as const, data: youtubeUrl }];
            analysis = await this.analyzeVideoWithGemini(videoSources, customPrompt);

        } else {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${toolName}`
          );
        }

        // Return successful analysis
        return {
          content: [
            {
              type: 'text',
              text: analysis,
            },
          ],
        };

      } catch (error) {
        console.error(`Error calling tool ${toolName}:`, error);
        const errorMessage = error instanceof McpError ? error.message : (error instanceof Error ? error.message : String(error));
        // Return error content
        return {
          content: [
            {
              type: 'text',
              text: `Tool execution error (${toolName}): ${errorMessage}`,
            },
          ],
          isError: true,
          errorCode: error instanceof McpError ? error.code : ErrorCode.InternalError,
        };
      }
    });
  }

  // Method to analyze images with Gemini Flash 2.0 using Native SDK
  private async analyzeImageWithGemini(
    imageSources: Array<{ type: 'url', data: string } | { type: 'base64', data: string, mimeType: string }>,
    promptText: string = 'Analyze the image content in detail and provide an explanation in English.' // Default prompt
  ): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using 2.0 flash

      const imageParts: Part[] = [];

      // Process all image sources concurrently
      await Promise.all(imageSources.map(async (source) => {
        let base64String: string;
        let finalMimeType: string;

        if (source.type === 'url') {
          console.log(`Fetching image from URL: ${source.data}`);
          let fetchResponse;
          try {
            fetchResponse = await axios.get(source.data, { responseType: 'arraybuffer' });
          } catch (error) {
            const message = axios.isAxiosError(error)
              ? `Failed to fetch image URL: ${error.message} (Status: ${error.response?.status})`
              : `Failed to fetch image URL: ${error instanceof Error ? error.message : String(error)}`;
            console.error(message);
            // Skip this image on error, or throw if all must succeed
            // throw new Error(message);
            return; // Skip this image
          }

          base64String = Buffer.from(fetchResponse.data, 'binary').toString('base64');
          finalMimeType = fetchResponse.headers['content-type']?.split(';')[0] || mime.lookup(source.data) || 'application/octet-stream';

          if (!finalMimeType.startsWith('image/')) {
             console.warn(`Skipping non-image content from URL ${source.data}: ${finalMimeType}`);
             return; // Skip this item
          }
          console.log(`Fetched image from URL ${source.data} (MIME: ${finalMimeType}).`);

        } else { // type === 'base64'
          base64String = source.data;
          finalMimeType = source.mimeType;
           if (!finalMimeType.startsWith('image/')) {
             console.warn(`Skipping non-image base64 data (MIME: ${finalMimeType})`);
             return; // Skip this item
           }
           console.log(`Processing provided base64 image (MIME: ${finalMimeType}).`);
        }

        // Add the processed image part to the array
        imageParts.push({
          inlineData: {
            data: base64String,
            mimeType: finalMimeType,
          },
        });
      })); // End Promise.all map

      if (imageParts.length === 0) {
        throw new Error("No valid images could be processed.");
      }

      console.log(`Sending ${imageParts.length} image(s) to Gemini with prompt: "${promptText}"`);

      // Prepare the request content array
      const contents: Content[] = [{ role: "user", parts: [{ text: promptText }, ...imageParts] }];

      const result = await model.generateContent({ contents });
      const response = result.response;

      if (!response || !response.candidates || response.candidates.length === 0) {
          throw new Error('Gemini API returned no candidates.');
      }

      // Check for safety blocks
      if (response.promptFeedback?.blockReason) {
           throw new Error(`Gemini API blocked the prompt: ${response.promptFeedback.blockReason}`);
      }
       if (response.candidates[0].finishReason !== 'STOP' && response.candidates[0].finishReason !== 'MAX_TOKENS') {
           throw new Error(`Gemini API stopped with reason: ${response.candidates[0].finishReason}`);
       }
       if (!response.candidates[0].content?.parts?.[0]?.text) {
           throw new Error('Gemini API returned no text content.');
       }


      return response.candidates[0].content.parts[0].text;

    } catch (error) {
      console.error(`Error during Gemini analysis:`, error);
      throw new Error(`Gemini API analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Method to analyze videos with Gemini 2.0 Flash using Native SDK
  private async analyzeVideoWithGemini(
    videoSources: Array<
      | { type: 'url', data: string }
      | { type: 'base64', data: string, mimeType: string }
      | { type: 'youtube', data: string } // Added YouTube type
    >,
    promptText: string = 'Analyze the video content in detail and provide an explanation in English.' // Default prompt
  ): Promise<string> {
    // Input validation (basic)
    if (!Array.isArray(videoSources) || videoSources.length === 0) {
      throw new Error("No video sources provided.");
    }

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const videoParts: Part[] = [];

      // Official Gemini Supported Video MIME types
      const supportedVideoMimeTypes = [
          'video/mp4', 'video/mpeg', 'video/mov', 'video/avi',
          'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'
      ];

      await Promise.all(videoSources.map(async (source, index) => {
        if (source.type === 'youtube') {
          console.log(`Processing YouTube URL: ${source.data}`);
          // YouTube URLs are passed directly via fileData
          videoParts[index] = ({ // Use index to maintain order roughly
            fileData: {
              // Mime type is often not needed for YouTube URIs per docs
              fileUri: source.data,
              mimeType: 'video/youtube' // Explicitly adding for clarity, might be optional
            }
          });
        } else { // Handle URL or Base64 (requires fetching/reading and encoding)
          let base64String: string;
          let inputMimeType: string; // Use a temp variable for the initial MIME type

          if (source.type === 'url') {
            console.log(`Fetching video from URL: ${source.data}`);
            let fetchResponse;
            try {
              // Increased timeout for potentially larger video files
              fetchResponse = await axios.get(source.data, {
                  responseType: 'arraybuffer',
                  timeout: 60000 // 60 second timeout for download
                });
            } catch (error) {
              const message = axios.isAxiosError(error)
                ? `Failed to fetch video URL: ${error.message} (Status: ${error.response?.status})`
                : `Failed to fetch video URL: ${error instanceof Error ? error.message : String(error)}`;
              console.error(message);
              // Mark this index as null or skip to avoid adding incomplete data
              videoParts[index] = null as any; // Mark as null, will filter later
              return;
            }

            base64String = Buffer.from(fetchResponse.data, 'binary').toString('base64');
            inputMimeType = fetchResponse.headers['content-type']?.split(';')[0] || mime.lookup(source.data) || 'application/octet-stream';

            console.log(`Fetched video from URL ${source.data} (Detected MIME: ${inputMimeType}). Size: ~${(base64String.length * 0.75 / (1024*1024)).toFixed(2)} MB`);

          } else { // type === 'base64'
            base64String = source.data;
            inputMimeType = source.mimeType;
            console.log(`Processing provided base64 video (Detected MIME: ${inputMimeType}). Size: ~${(base64String.length * 0.75 / (1024*1024)).toFixed(2)} MB`);
          }

          // --- MIME Type Mapping ---
           let finalMimeType = inputMimeType;
          if (inputMimeType === 'application/mp4') {
              finalMimeType = 'video/mp4';
              console.log(`Mapping MIME type application/mp4 -> video/mp4`);
          } else if (inputMimeType === 'video/quicktime') {
              finalMimeType = 'video/mov';
              console.log(`Mapping MIME type video/quicktime -> video/mov`);
          }
          // --- End MIME Type Mapping ---

          // Validate mapped MIME type for video using the official list
          if (!supportedVideoMimeTypes.includes(finalMimeType)) {
             console.warn(`Skipping unsupported or unmapped video content (MIME: ${finalMimeType}, Original: ${inputMimeType}) from source: ${source.type === 'url' ? source.data : '[base64]'}`);
             videoParts[index] = null as any; // Mark as null
             return; // Skip this item
          }

          // Check size limit (Gemini inline data limit is usually < 20MB)
           const approxSizeMB = base64String.length * 0.75 / (1024 * 1024);
           if (approxSizeMB > 19) { // Use 19MB as a safety margin for the ~20MB limit
                console.warn(`Skipping large video (Approx ${approxSizeMB.toFixed(2)} MB > 19MB limit for inline data) from source: ${source.type === 'url' ? source.data : '[base64]'}`);
                videoParts[index] = null as any; // Mark as null
                return; // Skip this large item
           }

          // Add the processed video part using inlineData with the potentially mapped finalMimeType
          videoParts[index] = ({ // Use index
            inlineData: {
              data: base64String,
              mimeType: finalMimeType, // Use the final, potentially mapped, MIME type
            },
          });
        }
      })); // End Promise.all map

      // Filter out any null entries from failed fetches/skips
      const finalVideoParts = videoParts.filter(part => part !== null);

      if (finalVideoParts.length === 0) {
        throw new Error("No valid videos could be processed or provided.");
      }

      console.log(`Sending ${finalVideoParts.length} video(s) to Gemini with prompt: "${promptText}"`);

      // Prepare the request content array
      const contents: Content[] = [{ role: "user", parts: [{ text: promptText }, ...finalVideoParts] }];

      // Generate content
      const result = await model.generateContent({ contents });
      const response = result.response;

      // --- Response Handling (same as image analysis) ---
       if (!response || !response.candidates || response.candidates.length === 0) {
          throw new Error('Gemini API returned no candidates.');
      }
      if (response.promptFeedback?.blockReason) {
           throw new Error(`Gemini API blocked the prompt: ${response.promptFeedback.blockReason}`);
      }
       if (response.candidates[0].finishReason !== 'STOP' && response.candidates[0].finishReason !== 'MAX_TOKENS') {
            // For video, FINISH_REASON_OTHER might indicate an issue with the video processing on Google's side.
            console.warn(`Gemini API finished with reason: ${response.candidates[0].finishReason}. Output might be incomplete or missing if video processing failed.`);
            // Allow potentially partial results, but throw if no text at all
            if (!response.candidates[0].content?.parts?.[0]?.text) {
                throw new Error(`Gemini API stopped with reason: ${response.candidates[0].finishReason} and returned no text.`);
            }
       }
       if (!response.candidates[0].content?.parts?.[0]?.text) {
           throw new Error('Gemini API returned no text content.');
       }
       return response.candidates[0].content.parts[0].text;
       // --- End Response Handling ---

    } catch (error) {
      console.error(`Error during Gemini video analysis:`, error);
      throw new Error(`Gemini API video analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Image Analysis MCP server (v1.1.0) running on stdio'); // Updated version
  }
}

const server = new ImageAnalysisServer();
server.run().catch(console.error);
