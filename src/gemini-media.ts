import { GoogleGenAI, Content, Part } from '@google/genai';
import axios from 'axios';
import * as mime from 'mime-types';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

export type UrlImageSource = { type: 'url'; data: string };
export type LocalImageSource = {
    type: 'local';
    data: string;
    mimeType?: string;
};
export type ImageSource = UrlImageSource | LocalImageSource;

export type UrlVideoSource = { type: 'url'; data: string };
export type LocalVideoSource = {
    type: 'local';
    data: string;
    mimeType?: string;
};
export type YouTubeVideoSource = { type: 'youtube'; data: string };
export type VideoSource = UrlVideoSource | LocalVideoSource | YouTubeVideoSource;

export const supportedVideoMimeTypes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-flv',
    'video/webm',
    'video/x-ms-wmv',
    'video/3gpp',
    'video/ogg',
] as const;

const DEFAULT_FILE_POLL_INTERVAL_MS = 2000;
const DEFAULT_FILE_POLL_MAX_ATTEMPTS = 60;
const FILE_POLL_INTERVAL_ENV = 'GEMINI_FILE_POLL_INTERVAL_MS';
const FILE_POLL_MAX_ATTEMPTS_ENV = 'GEMINI_FILE_POLL_MAX_ATTEMPTS';

function resolveFilePollInterval(): number {
    return parseIntegerEnv(
        FILE_POLL_INTERVAL_ENV,
        DEFAULT_FILE_POLL_INTERVAL_MS,
        0,
        60_000,
    );
}

function resolveFilePollMaxAttempts(): number {
    return parseIntegerEnv(
        FILE_POLL_MAX_ATTEMPTS_ENV,
        DEFAULT_FILE_POLL_MAX_ATTEMPTS,
        1,
        1_000,
    );
}

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }

    const clamped = Math.min(max, Math.max(min, parsed));
    return clamped;
}

const DEFAULT_IMAGE_PROMPT =
    'Analyze the image content in detail and provide an explanation.';
const DEFAULT_VIDEO_PROMPT =
    'Analyze the video content in detail and provide an explanation.';

type LocalSource = LocalImageSource | LocalVideoSource;

export class GeminiMediaAnalyzer {
    private readonly filePollIntervalMs: number;
    private readonly filePollMaxAttempts: number;

    constructor(
        private readonly client: GoogleGenAI,
        private readonly modelName: string,
    ) {
        this.filePollIntervalMs = resolveFilePollInterval();
        this.filePollMaxAttempts = resolveFilePollMaxAttempts();
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

            console.log(
                `Sending ${imageParts.length} image(s) to Gemini with prompt: "${promptText}"`,
            );

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
            throw new Error('No video sources provided.');
        }

        try {
            const parts: Array<Part | null> = await Promise.all(
                videoSources.map((source, index) => this.createVideoPart(source, index)),
            );

            const videoParts = parts.filter((part): part is Part => part !== null);
            if (videoParts.length === 0) {
                throw new Error('No valid videos could be processed or provided.');
            }

            console.log(
                `Sending ${videoParts.length} video(s) to Gemini with prompt: "${promptText}"`,
            );

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
            console.log(`Fetching image from URL: ${source.data}`);
            try {
                const response = await axios.get(source.data, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data, 'binary');
                const mimeType =
                    response.headers['content-type']?.split(';')[0] ||
                    mime.lookup(source.data) ||
                    'application/octet-stream';

                if (!mimeType.startsWith('image/')) {
                    console.warn(`Skipping non-image content from URL ${source.data}: ${mimeType}`);
                    return null;
                }

                const displayName = deriveDisplayNameFromSource(source.data, 'image');
                return await this.uploadBufferAsFile(buffer, {
                    kind: 'image',
                    mimeType,
                    suggestedName: displayName,
                    index,
                    originHint: source.data,
                });
            } catch (error) {
                const message = axios.isAxiosError(error)
                    ? `Failed to fetch image URL: ${error.message} (Status: ${error.response?.status})`
                    : `Failed to fetch image URL: ${error instanceof Error ? error.message : String(error)}`;
                console.error(message);
                return null;
            }
        }

        if (source.type === 'local') {
            return this.uploadLocalFile(source, 'image', index);
        }

        console.warn(`Ignoring unsupported image source type at index ${index}.`);
        return null;
    }

    private async createVideoPart(source: VideoSource, index: number): Promise<Part | null> {
        if (source.type === 'youtube') {
            console.log(`Processing YouTube URL: ${source.data}`);
            return {
                fileData: {
                    fileUri: source.data,
                    mimeType: 'video/*',
                },
            } satisfies Part;
        }

        if (source.type === 'url') {
            console.log(`Fetching video from URL: ${source.data}`);
            try {
                const response = await axios.get(source.data, {
                    responseType: 'arraybuffer',
                    timeout: 60_000,
                });

                const buffer = Buffer.from(response.data, 'binary');
                const inputMimeType =
                    response.headers['content-type']?.split(';')[0] ||
                    mime.lookup(source.data) ||
                    'application/octet-stream';

                const approxSizeMb = buffer.length / (1024 * 1024);
                console.log(
                    `Processing video source (${inputMimeType}) ~${approxSizeMb.toFixed(2)} MB`,
                );

                const finalMimeType = mapVideoMimeType(inputMimeType).toLowerCase();
                if (!isSupportedVideoMimeType(finalMimeType)) {
                    console.warn(
                        `Skipping unsupported video content (Mapped: ${finalMimeType}, Original: ${inputMimeType})`,
                    );
                    return null;
                }

                const displayName = deriveDisplayNameFromSource(source.data, 'video');
                return await this.uploadBufferAsFile(buffer, {
                    kind: 'video',
                    mimeType: finalMimeType,
                    suggestedName: displayName,
                    index,
                    originHint: source.data,
                });
            } catch (error) {
                const message = axios.isAxiosError(error)
                    ? `Failed to fetch video URL: ${error.message} (Status: ${error.response?.status})`
                    : `Failed to fetch video URL: ${error instanceof Error ? error.message : String(error)}`;
                console.error(message);
                return null;
            }
        }

        if (source.type === 'local') {
            return this.uploadLocalFile(source, 'video', index);
        }

        console.warn(`Ignoring unsupported video source type at index ${index}.`);
        return null;
    }

    private async uploadLocalFile(
        source: LocalSource,
        kind: 'image' | 'video',
        index: number,
    ): Promise<Part> {
        const prepared = await resolveLocalFile(source, kind, index);

        console.log(
            `Uploading local ${kind} file via Gemini Files API: ${prepared.path} (${prepared.mimeType})`,
        );

        const filesModule = this.client.files;
        if (!filesModule || typeof filesModule.upload !== 'function') {
            throw new Error('Gemini Files API is not available in this SDK version.');
        }

        const uploaded = await filesModule.upload({
            file: prepared.path,
            config: {
                mimeType: prepared.mimeType,
            },
        });

        const activeFile = await this.waitForFileActivation(
            uploaded,
            filesModule,
            kind,
            prepared.path,
        );

        const fileUri = activeFile?.uri ?? activeFile?.name;
        if (!fileUri) {
            throw new Error(
                `Gemini Files API did not return a URI for uploaded ${kind} file (${prepared.path}).`,
            );
        }

        const resolvedMime = activeFile?.mimeType ?? prepared.mimeType;
        return {
            fileData: {
                fileUri,
                mimeType: resolvedMime,
            },
        } satisfies Part;
    }

    private async uploadBufferAsFile(
        buffer: Buffer,
        options: {
            kind: 'image' | 'video';
            mimeType: string;
            index: number;
            originHint?: string;
            suggestedName?: string;
        },
    ): Promise<Part> {
        const { kind, mimeType, index, originHint, suggestedName } = options;
        const extension = mime.extension(mimeType) || undefined;
        const fallbackName = deriveDefaultName(kind, extension);
        const baseName = sanitizeFileName(suggestedName ?? fallbackName);
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-upload-'));
        const tempPath = path.join(tempDir, baseName);

        await fs.writeFile(tempPath, buffer);

        try {
            const part = await this.uploadLocalFile(
                {
                    type: 'local',
                    data: tempPath,
                    mimeType,
                },
                kind,
                index,
            );

            if (originHint) {
                console.log(
                    `Uploaded ${kind} from remote source (${originHint}) via Gemini Files API as ${baseName}.`,
                );
            }

            return part;
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    private async waitForFileActivation(
        initial: Awaited<ReturnType<NonNullable<GoogleGenAI['files']>['upload']>>,
        filesModule: NonNullable<GoogleGenAI['files']>,
        kind: 'image' | 'video',
        sourcePath: string,
    ): Promise<Awaited<ReturnType<NonNullable<GoogleGenAI['files']>['upload']>>> {
        const fileName = initial.name;
        if (!fileName || typeof filesModule.get !== 'function') {
            return initial;
        }

        let latest = initial;
        for (let attempt = 0; attempt < this.filePollMaxAttempts; attempt += 1) {
            const state = latest?.state ?? 'ACTIVE';
            if (!state || state === 'ACTIVE') {
                return latest;
            }

            if (state === 'FAILED') {
                const reason = (latest as any)?.error?.message;
                const context = reason ? ` Reason: ${reason}` : '';
                throw new Error(
                    `Gemini Files API reported FAILED state for uploaded ${kind} file (${sourcePath}).${context}`,
                );
            }

            if (attempt >= this.filePollMaxAttempts - 1) {
                break;
            }

            if (this.filePollIntervalMs > 0) {
                await delay(this.filePollIntervalMs);
            }

            const lookupName = latest?.name ?? fileName;
            try {
                latest = await filesModule.get({ name: lookupName });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                    `Failed to poll Gemini Files API for uploaded ${kind} file (${sourcePath}): ${message}`,
                );
            }
        }

        const finalState = latest?.state;
        throw new Error(
            `Timed out waiting for Gemini Files API to process uploaded ${kind} file (${sourcePath}). Last known state: ${finalState ?? 'unknown'}.`,
        );
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

function mapVideoMimeType(mimeType: string): string {
    const lowered = mimeType.toLowerCase();

    if (lowered === 'application/mp4') {
        console.log('Mapping MIME type application/mp4 -> video/mp4');
        return 'video/mp4';
    }

    if (lowered === 'video/wmv') {
        console.log('Mapping MIME type video/wmv -> video/x-ms-wmv');
        return 'video/x-ms-wmv';
    }

    if (lowered === 'video/avi') {
        console.log('Mapping MIME type video/avi -> video/x-msvideo');
        return 'video/x-msvideo';
    }

    if (lowered === 'video/mov') {
        console.log('Mapping MIME type video/mov -> video/quicktime');
        return 'video/quicktime';
    }

    if (lowered === 'video/mpg') {
        console.log('Mapping MIME type video/mpg -> video/mpeg');
        return 'video/mpeg';
    }

    return mimeType;
}

function isSupportedVideoMimeType(
    mimeType: string,
): mimeType is (typeof supportedVideoMimeTypes)[number] {
    const lowered = mimeType.toLowerCase();
    return (supportedVideoMimeTypes as readonly string[]).includes(lowered);
}

function deriveDefaultName(kind: 'image' | 'video', extension?: string): string {
    const normalizedExtension = extension ? extension.replace(/^\./, '') : undefined;
    const suffix = normalizedExtension ? `.${normalizedExtension}` : '';
    return `${kind}-${Date.now()}${suffix}`;
}

function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
}

function deriveDisplayNameFromSource(source: string, kind: 'image' | 'video'): string | undefined {
    try {
        const parsed = new URL(source);
        const pathname = parsed.pathname;
        const candidate = pathname.split('/').filter(Boolean).pop();
        if (candidate && candidate.includes('.')) {
            return candidate;
        }
    } catch {
        // ignore parsing issues and fall back to default naming
    }
    return undefined;
}

async function resolveLocalFile(
    source: LocalSource,
    kind: 'image' | 'video',
    index: number,
): Promise<{ path: string; mimeType: string }> {
    const locatedPath = await locateLocalMediaFile(source.data, kind, index);
    const declared = source.mimeType?.trim();
    const inferred = (mime.lookup(locatedPath) || undefined)?.toString();
    const mimeType = declared || inferred;

    if (!mimeType) {
        throw new Error(
            `Unable to determine MIME type for ${kind} file at index ${index} (${source.data}). Please specify mimeType explicitly.`,
        );
    }

    const normalizedMime = mimeType.toLowerCase();

    if (!normalizedMime.startsWith(`${kind}/`)) {
        throw new Error(
            `Local ${kind} file at index ${index} must have a MIME type starting with "${kind}/" (resolved: ${mimeType}).`,
        );
    }

    return {
        path: locatedPath,
        mimeType: normalizedMime,
    };
}

async function locateLocalMediaFile(
    rawPath: string,
    kind: 'image' | 'video',
    index: number,
): Promise<string> {
    const trimmed = rawPath?.trim();
    if (!trimmed) {
        throw new Error(`Empty path provided for ${kind} file at index ${index}.`);
    }

    let normalized: string;
    try {
        normalized = normalizeInputPath(trimmed);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Invalid ${kind} file path at index ${index} (${rawPath}): ${reason}`,
        );
    }

    const candidates = buildPathCandidates(normalized);
    const attempted: string[] = [];
    let lastError: NodeJS.ErrnoException | undefined;

    for (const candidate of candidates) {
        attempted.push(candidate);
        try {
            const stats = await fs.stat(candidate);
            if (stats.isFile()) {
                return candidate;
            }

            lastError = Object.assign(new Error('Not a file'), { code: 'ENOTFILE' }) as NodeJS.ErrnoException;
        } catch (error) {
            if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
                lastError = error as NodeJS.ErrnoException;
                continue;
            }

            throw new Error(
                `Failed to access ${kind} file at index ${index} (${rawPath}): ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    const attemptedDetails = attempted.length ? ` Checked: ${attempted.join(', ')}` : '';
    const reason = lastError?.message ?? 'File does not exist.';
    throw new Error(`Failed to access ${kind} file at index ${index} (${rawPath}): ${reason}.${attemptedDetails}`);
}

function buildPathCandidates(rawPath: string): string[] {
    if (path.isAbsolute(rawPath)) {
        return [path.normalize(rawPath)];
    }

    const searchRoots = getMediaSearchRoots();
    const candidates = new Set<string>();

    for (const root of searchRoots) {
        candidates.add(path.resolve(root, rawPath));
    }

    candidates.add(path.resolve(rawPath));
    return Array.from(candidates);
}

function getMediaSearchRoots(): string[] {
    const combined = new Set<string>();

    const envSources = [
        process.env.MCP_MEDIA_BASE_DIRS,
        process.env.MCP_MEDIA_BASE_DIR,
        process.env.MCP_MEDIA_SEARCH_DIRS,
        process.env.MCP_WORKSPACE_ROOT,
        process.env.WORKSPACE_ROOT,
    ];

    for (const raw of envSources) {
        for (const entry of parseMediaRootList(raw)) {
            combined.add(path.resolve(entry));
        }
    }

    const defaults = [process.cwd(), process.env.INIT_CWD, process.env.PWD]
        .filter((value): value is string => Boolean(value && value.trim().length))
        .map((value) => path.resolve(value));

    for (const entry of defaults) {
        combined.add(entry);
    }

    return Array.from(combined);
}

function parseMediaRootList(raw: string | undefined): string[] {
    if (!raw) {
        return [];
    }

    const trimmed = raw.trim();
    if (!trimmed) {
        return [];
    }

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
                    .filter((item) => item.length > 0);
            }
        } catch {
            // Fall back to delimiter parsing below.
        }
    }

    return trimmed
        .split(/[,;\n]/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
}

async function delay(ms: number): Promise<void> {
    if (ms <= 0) {
        return;
    }

    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

function normalizeInputPath(rawPath: string): string {
    const expanded = expandHomeDirectory(rawPath);
    if (/^file:/i.test(expanded)) {
        return fileURLToPath(new URL(expanded));
    }

    return expanded;
}

function expandHomeDirectory(input: string): string {
    if (!input.startsWith('~')) {
        return input;
    }

    const homeDir = os.homedir();
    if (!homeDir) {
        return input;
    }

    if (input === '~') {
        return homeDir;
    }

    const remainder = input.slice(1);
    const stripped = remainder.replace(/^[\\\/]+/, '');
    return path.join(homeDir, stripped);
}
