import { GoogleGenAI, Content, Part } from '@google/genai';

export type UrlImageSource = { type: 'url'; data: string };
export type UrlVideoSource = { type: 'url'; data: string };
export type YouTubeVideoSource = { type: 'youtube'; data: string };

export type ImageSource = UrlImageSource;
export type VideoSource = UrlVideoSource | YouTubeVideoSource;

const DEFAULT_IMAGE_PROMPT =
    'Analyze the image content in detail and provide an explanation.';
const DEFAULT_VIDEO_PROMPT =
    'Analyze the video content in detail and provide an explanation.';
const IMAGE_MIME_TYPE = 'image/*';
const VIDEO_MIME_TYPE = 'video/*';

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

    async analyzeVideoUrls(
        videoUrls: string[],
        promptText: string = DEFAULT_VIDEO_PROMPT,
    ): Promise<string> {
        if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
            throw new Error('No video URLs provided.');
        }

        const sources: VideoSource[] = videoUrls.map((data) => ({ type: 'url', data }));
        return this.analyzeVideos(sources, promptText);
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
        if (source.type !== 'url') {
            console.warn(`Ignoring unsupported image source type at index ${index}.`);
            return null;
        }

        if (!isValidHttpUrl(source.data)) {
            console.warn(`Skipping invalid image URL at index ${index}: ${source.data}`);
            return null;
        }

        return {
            fileData: {
                fileUri: source.data,
                mimeType: IMAGE_MIME_TYPE,
            },
        } satisfies Part;
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
                    mimeType: VIDEO_MIME_TYPE,
                },
            } satisfies Part;
        }

        if (source.type !== 'url') {
            console.warn(`Ignoring unsupported video source type at index ${index}.`);
            return null;
        }

        if (!isValidHttpUrl(source.data)) {
            console.warn(`Skipping invalid video URL at index ${index}: ${source.data}`);
            return null;
        }

        return {
            fileData: {
                fileUri: source.data,
                mimeType: VIDEO_MIME_TYPE,
            },
        } satisfies Part;
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

