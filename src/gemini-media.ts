import { GoogleGenerativeAI, Content, Part } from "@google/generative-ai";
import axios from "axios";
import * as mime from "mime-types";

export type UrlImageSource = { type: "url"; data: string };
export type Base64ImageSource = {
    type: "base64";
    data: string;
    mimeType: string;
};
export type ImageSource = UrlImageSource | Base64ImageSource;

export type UrlVideoSource = { type: "url"; data: string };
export type Base64VideoSource = {
    type: "base64";
    data: string;
    mimeType: string;
};
export type YouTubeVideoSource = { type: "youtube"; data: string };
export type VideoSource = UrlVideoSource | Base64VideoSource | YouTubeVideoSource;

export const supportedVideoMimeTypes = [
    "video/mp4",
    "video/mpeg",
    "video/mov",
    "video/avi",
    "video/x-flv",
    "video/mpg",
    "video/webm",
    "video/wmv",
    "video/3gpp"
] as const;

const INLINE_VIDEO_SIZE_LIMIT_MB = 19;
const DEFAULT_IMAGE_PROMPT =
    "Analyze the image content in detail and provide an explanation in English.";
const DEFAULT_VIDEO_PROMPT =
    "Analyze the video content in detail and provide an explanation in English.";

export class GeminiMediaAnalyzer {
    constructor(
        private readonly genAI: GoogleGenerativeAI,
        private readonly modelName: string
    ) { }

    async analyzeImages(
        imageSources: ImageSource[],
        promptText: string = DEFAULT_IMAGE_PROMPT
    ): Promise<string> {
        if (!Array.isArray(imageSources) || imageSources.length === 0) {
            throw new Error("No image sources provided.");
        }

        try {
            const model = this.genAI.getGenerativeModel({ model: this.modelName });

            const parts = await Promise.all(
                imageSources.map(async (source): Promise<Part | null> => {
                    if (source.type === "url") {
                        console.log(`Fetching image from URL: ${source.data}`);
                        try {
                            const response = await axios.get(source.data, {
                                responseType: "arraybuffer",
                            });
                            const base64 = Buffer.from(response.data, "binary").toString(
                                "base64"
                            );
                            const mimeType =
                                response.headers["content-type"]?.split(";")[0] ||
                                mime.lookup(source.data) ||
                                "application/octet-stream";

                            if (!mimeType.startsWith("image/")) {
                                console.warn(
                                    `Skipping non-image content from URL ${source.data}: ${mimeType}`
                                );
                                return null;
                            }

                            return {
                                inlineData: {
                                    data: base64,
                                    mimeType,
                                },
                            } satisfies Part;
                        } catch (error) {
                            const message = axios.isAxiosError(error)
                                ? `Failed to fetch image URL: ${error.message} (Status: ${error.response?.status})`
                                : `Failed to fetch image URL: ${error instanceof Error ? error.message : String(error)}`;
                            console.error(message);
                            return null;
                        }
                    }

                    const mimeType = source.mimeType;
                    if (!mimeType.startsWith("image/")) {
                        console.warn(`Skipping non-image base64 data (MIME: ${mimeType})`);
                        return null;
                    }

                    console.log(`Processing provided base64 image (MIME: ${mimeType}).`);
                    return {
                        inlineData: {
                            data: source.data,
                            mimeType,
                        },
                    } satisfies Part;
                })
            );

            const imageParts = parts.filter((part): part is Part => part !== null);

            if (imageParts.length === 0) {
                throw new Error("No valid images could be processed.");
            }

            console.log(
                `Sending ${imageParts.length} image(s) to Gemini with prompt: "${promptText}"`
            );

            const contents: Content[] = [
                { role: "user", parts: [{ text: promptText }, ...imageParts] },
            ];

            const result = await model.generateContent({ contents });
            return extractText(result.response);
        } catch (error) {
            console.error(`Error during Gemini analysis:`, error);
            throw new Error(
                `Gemini API analysis error: ${error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    async analyzeVideos(
        videoSources: VideoSource[],
        promptText: string = DEFAULT_VIDEO_PROMPT
    ): Promise<string> {
        if (!Array.isArray(videoSources) || videoSources.length === 0) {
            throw new Error("No video sources provided.");
        }

        try {
            const model = this.genAI.getGenerativeModel({ model: this.modelName });

            const parts = await Promise.all(
                videoSources.map(async (source): Promise<Part | null> => {
                    if (source.type === "youtube") {
                        console.log(`Processing YouTube URL: ${source.data}`);
                        return {
                            fileData: {
                                fileUri: source.data,
                                mimeType: "video/youtube",
                            },
                        } satisfies Part;
                    }

                    let base64String: string;
                    let inputMimeType: string;

                    if (source.type === "url") {
                        console.log(`Fetching video from URL: ${source.data}`);
                        try {
                            const response = await axios.get(source.data, {
                                responseType: "arraybuffer",
                                timeout: 60_000,
                            });
                            base64String = Buffer.from(response.data, "binary").toString(
                                "base64"
                            );
                            inputMimeType =
                                response.headers["content-type"]?.split(";")[0] ||
                                mime.lookup(source.data) ||
                                "application/octet-stream";
                        } catch (error) {
                            const message = axios.isAxiosError(error)
                                ? `Failed to fetch video URL: ${error.message} (Status: ${error.response?.status})`
                                : `Failed to fetch video URL: ${error instanceof Error ? error.message : String(error)}`;
                            console.error(message);
                            return null;
                        }
                    } else {
                        base64String = source.data;
                        inputMimeType = source.mimeType;
                    }

                    const approxSizeMb = (base64String.length * 0.75) / (1024 * 1024);
                    console.log(
                        `Processing video source (${inputMimeType}) ~${approxSizeMb.toFixed(
                            2
                        )} MB`
                    );

                    let finalMimeType = mapVideoMimeType(inputMimeType);

                    if (!isSupportedVideoMimeType(finalMimeType)) {
                        console.warn(
                            `Skipping unsupported video content (Mapped: ${finalMimeType}, Original: ${inputMimeType})`
                        );
                        return null;
                    }

                    if (approxSizeMb > INLINE_VIDEO_SIZE_LIMIT_MB) {
                        console.warn(
                            `Skipping large video (~${approxSizeMb.toFixed(
                                2
                            )} MB > ${INLINE_VIDEO_SIZE_LIMIT_MB} MB inline limit)`
                        );
                        return null;
                    }

                    return {
                        inlineData: {
                            data: base64String,
                            mimeType: finalMimeType,
                        },
                    } satisfies Part;
                })
            );

            const videoParts = parts.filter((part): part is Part => part !== null);

            if (videoParts.length === 0) {
                throw new Error("No valid videos could be processed or provided.");
            }

            console.log(
                `Sending ${videoParts.length} video(s) to Gemini with prompt: "${promptText}"`
            );

            const contents: Content[] = [
                { role: "user", parts: [{ text: promptText }, ...videoParts] },
            ];

            const result = await model.generateContent({ contents });
            return extractText(result.response, true);
        } catch (error) {
            console.error(`Error during Gemini video analysis:`, error);
            throw new Error(
                `Gemini API video analysis error: ${error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }
}

function extractText(response: any, isVideo = false): string {
    if (!response?.candidates?.length) {
        throw new Error("Gemini API returned no candidates.");
    }

    if (response.promptFeedback?.blockReason) {
        throw new Error(
            `Gemini API blocked the prompt: ${response.promptFeedback.blockReason}`
        );
    }

    const finishReason = response.candidates[0].finishReason;
    if (
        finishReason !== "STOP" &&
        finishReason !== "MAX_TOKENS"
    ) {
        const context = isVideo
            ? "Output might be incomplete or missing if video processing failed."
            : "";
        console.warn(
            `Gemini API finished with reason: ${finishReason}. ${context}`.trim()
        );
    }

    const text = response.candidates[0].content?.parts?.[0]?.text;
    if (!text) {
        throw new Error("Gemini API returned no text content.");
    }

    return text;
}

function mapVideoMimeType(mimeType: string): string {
    if (mimeType === "application/mp4") {
        console.log("Mapping MIME type application/mp4 -> video/mp4");
        return "video/mp4";
    }

    if (mimeType === "video/quicktime") {
        console.log("Mapping MIME type video/quicktime -> video/mov");
        return "video/mov";
    }

    return mimeType;
}

function isSupportedVideoMimeType(
    mimeType: string
): mimeType is (typeof supportedVideoMimeTypes)[number] {
    return (supportedVideoMimeTypes as readonly string[]).includes(mimeType);
}
