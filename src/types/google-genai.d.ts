declare module '@google/genai' {
    export interface TextPart {
        text: string;
    }

    export interface InlineDataPart {
        inlineData: {
            data: string;
            mimeType: string;
        };
    }

    export interface FileDataPart {
        fileData: {
            fileUri: string;
            mimeType: string;
            displayName?: string;
        };
    }

    export type Part = TextPart | InlineDataPart | FileDataPart;

    export interface Content {
        role: string;
        parts: Part[];
    }

    export interface GenerateContentParams {
        model: string;
        contents: Content[];
    }

    export interface GenerateContentResult {
        text?: string;
        candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
            finishReason?: string;
        }>;
        promptFeedback?: {
            blockReason?: string;
        };
    }

    export interface ModelsModule {
        generateContent(params: GenerateContentParams): Promise<GenerateContentResult>;
    }

    export interface FilesUploadConfig {
        mimeType?: string;
        displayName?: string;
    }

    export interface FilesUploadParams {
        file: string;
        config?: FilesUploadConfig;
    }

    export interface FilesUploadResult {
        uri?: string;
        name?: string;
        mimeType?: string;
        displayName?: string;
        state?: 'ACTIVE' | 'PROCESSING' | 'FAILED' | string | null;
        error?: {
            message?: string;
        } | null;
    }

    export interface FilesGetParams {
        name: string;
    }

    export type FilesGetResult = FilesUploadResult;

    export interface FilesModule {
        upload(params: FilesUploadParams): Promise<FilesUploadResult>;
        get(params: FilesGetParams): Promise<FilesGetResult>;
    }

    export interface GoogleGenAIOptions {
        apiKey: string;
    }

    export class GoogleGenAI {
        constructor(options: GoogleGenAIOptions);
        readonly models: ModelsModule;
        readonly files: FilesModule;
    }
}
