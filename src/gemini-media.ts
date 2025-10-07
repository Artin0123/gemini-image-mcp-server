import { GoogleGenAI, Content, Part } from '@google/genai';

export type UrlImageSource = { type: 'url'; data: string };
export type YouTubeVideoSource = { type: 'youtube'; data: string };

export type ImageSource = UrlImageSource;
export type VideoSource = YouTubeVideoSource;

const DEFAULT_IMAGE_PROMPT =
    'Analyze the image content in detail and provide an explanation.';
const DEFAULT_VIDEO_PROMPT =
    'Analyze the video content in detail and provide an explanation.';
const IMAGE_MIME_FALLBACK = 'image/*';
const VIDEO_MIME_FALLBACK = 'video/*';
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const IMAGE_EXTENSION_TO_MIME = new Map<string, string>([
    ['.apng', 'image/apng'],
    ['.avif', 'image/avif'],
    ['.gif', 'image/gif'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp'],
]);

export class GeminiMediaAnalyzer {
    constructor(
        private readonly client: GoogleGenAI,
        private readonly modelName: string,
    ) { }

    async analyzeImageUrls(
        imageUrls: string[],
        promptText: string = DEFAULT_IMAGE_PROMPT,
    ): Promise<string> {
        if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
            throw new Error('No image URLs provided.');
        }

        const sources: ImageSource[] = imageUrls.map((data) => ({ type: 'url', data }));
        return this.analyzeImages(sources, promptText);
    }

    async analyzeYouTubeVideo(
        youtubeUrl: string,
        promptText: string = DEFAULT_VIDEO_PROMPT,
    ): Promise<string> {
        if (!youtubeUrl || !youtubeUrl.trim()) {
            throw new Error('YouTube URL is required.');
        }

        return this.analyzeVideos([{ type: 'youtube', data: youtubeUrl }], promptText);
    }

    async analyzeImages(
        imageSources: ImageSource[],
        promptText: string = DEFAULT_IMAGE_PROMPT,
    ): Promise<string> {
        if (!Array.isArray(imageSources) || imageSources.length === 0) {
            throw new Error('No image sources provided.');
        }

        try {
            const parts: Array<Part | null> = await Promise.all(
                imageSources.map((source, index) => this.createImagePart(source, index)),
            );

            const imageParts = parts.filter((part): part is Part => part !== null);
            if (imageParts.length === 0) {
                throw new Error('No valid images could be processed.');
            }

            const contents: Content[] = [
                {
                    role: 'user',
                    parts: [{ text: promptText }, ...imageParts],
                },
            ];

            const response = await this.client.models.generateContent({
                model: this.modelName,
                contents,
            });

            return extractText(response);
        } catch (error) {
            console.error('Error during Gemini analysis:', error);
            throw new Error(
                `Gemini API analysis error: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async analyzeVideos(
        videoSources: VideoSource[],
        promptText: string = DEFAULT_VIDEO_PROMPT,
    ): Promise<string> {
        if (!Array.isArray(videoSources) || videoSources.length === 0) {
            throw new Error('No video URLs provided.');
        }

        try {
            const parts: Array<Part | null> = await Promise.all(
                videoSources.map((source, index) => this.createVideoPart(source, index)),
            );

            const videoParts = parts.filter((part): part is Part => part !== null);
            if (videoParts.length === 0) {
                throw new Error('No valid videos could be processed or provided.');
            }

            const contents: Content[] = [
                {
                    role: 'user',
                    parts: [{ text: promptText }, ...videoParts],
                },
            ];

            const response = await this.client.models.generateContent({
                model: this.modelName,
                contents,
            });

            return extractText(response, true);
        } catch (error) {
            console.error('Error during Gemini video analysis:', error);
            throw new Error(
                `Gemini API video analysis error: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async createImagePart(source: ImageSource, index: number): Promise<Part | null> {
        if (source.type === 'url') {
            if (!isValidHttpUrl(source.data)) {
                console.warn(`Skipping invalid image URL at index ${index}: ${source.data}`);
                return null;
            }

            console.log(`Fetching image from URL: ${source.data}`);
            try {
                // 使用 fetch 下載圖片
                const response = await fetch(source.data);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // 檢查檔案大小
                const fileSizeMB = buffer.length / (1024 * 1024);
                if (buffer.length > MAX_FILE_SIZE_BYTES) {
                    const errorMsg = `Image size ${fileSizeMB.toFixed(2)} MB exceeds maximum allowed size of ${MAX_FILE_SIZE_MB} MB`;
                    console.warn(`Skipping large image from URL: ${source.data}`);
                    throw new Error(errorMsg);
                }

                // 獲取 MIME type
                const mimeType = response.headers.get('content-type')?.split(';')[0] ||
                    detectImageMimeType(source.data);

                if (!mimeType.startsWith('image/')) {
                    console.warn(`Skipping non-image content from URL ${source.data}: ${mimeType}`);
                    return null;
                }

                console.log(`Image downloaded: ${fileSizeMB.toFixed(2)} MB (${mimeType})`);

                // 轉換為 base64 並使用 inlineData
                const base64Data = buffer.toString('base64');
                return {
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType,
                    },
                } satisfies Part;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                // 如果是檔案大小超限錯誤,重新拋出讓用戶看到
                if (errorMessage.includes('exceeds maximum allowed size')) {
                    throw error;
                }

                // 其他錯誤記錄後返回 null
                console.error(`Failed to fetch image URL: ${errorMessage}`);
                return null;
            }
        }

        console.warn(`Ignoring unsupported image source type at index ${index}.`);
        return null;
    }

    private async createVideoPart(source: VideoSource, index: number): Promise<Part | null> {
        if (source.type === 'youtube') {
            if (!isValidHttpUrl(source.data)) {
                console.warn(`Skipping invalid YouTube URL at index ${index}: ${source.data}`);
                return null;
            }

            return {
                fileData: {
                    fileUri: source.data,
                    mimeType: VIDEO_MIME_FALLBACK,
                },
            } satisfies Part;
        }

        console.warn(`Ignoring unsupported video source type at index ${index}.`);
        return null;
    }
}

function isValidHttpUrl(candidate: string): boolean {
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function detectImageMimeType(value: string): string {
    return detectMimeTypeFromUrl(value, IMAGE_EXTENSION_TO_MIME, IMAGE_MIME_FALLBACK);
}

function detectMimeTypeFromUrl(
    value: string,
    table: Map<string, string>,
    fallback: string,
): string {
    try {
        const url = new URL(value);
        const pathname = url.pathname;
        const dotIndex = pathname.lastIndexOf('.');
        if (dotIndex >= 0) {
            const ext = pathname.slice(dotIndex).toLowerCase();
            const mime = table.get(ext);
            if (mime) {
                return mime;
            }
        }
    } catch {
        const match = value.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        if (match) {
            const ext = `.${match[1].toLowerCase()}`;
            const mime = table.get(ext);
            if (mime) {
                return mime;
            }
        }
    }

    return fallback;
}

function extractText(response: any, isVideo = false): string {
    if (typeof response?.text === 'string' && response.text.trim().length > 0) {
        return response.text;
    }

    if (!response?.candidates?.length) {
        throw new Error('Gemini API returned no candidates.');
    }

    if (response.promptFeedback?.blockReason) {
        throw new Error(
            `Gemini API blocked the prompt: ${response.promptFeedback.blockReason}`,
        );
    }

    const firstCandidate = response.candidates[0];
    const finishReason = firstCandidate?.finishReason;
    if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
        const context = isVideo
            ? 'Output might be incomplete or missing if video processing failed.'
            : '';
        console.warn(
            `Gemini API finished with reason: ${finishReason}. ${context}`.trim(),
        );
    }

    const text = firstCandidate?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Gemini API returned no text content.');
    }

    return text;
}
