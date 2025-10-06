import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import crypto from 'node:crypto';
import axios from 'axios';
import { pathToFileURL } from 'node:url';
import { GeminiMediaAnalyzer } from '../src/gemini-media.js';

test('analyzeImages uploads local files and forwards prompt text to the Gemini model', async () => {
    const tempPath = path.join(os.tmpdir(), `gemini-media-${crypto.randomUUID()}.png`);
    await fs.writeFile(tempPath, Buffer.from('test-image-data'));

    let recordedModel: string | undefined;
    let recordedContents: unknown;
    const uploaded: Array<{ file: string; mimeType?: string; displayName?: string }> = [];

    const fakeClient = {
        models: {
            async generateContent({ model, contents }: { model: string; contents: unknown }) {
                recordedModel = model;
                recordedContents = contents;
                return {
                    text: 'analysis result',
                };
            },
        },
        files: {
            async upload({ file, config }: { file: string; config?: { mimeType?: string; displayName?: string } }) {
                uploaded.push({ file, mimeType: config?.mimeType, displayName: config?.displayName });
                return {
                    uri: `files/${path.basename(file)}`,
                    mimeType: config?.mimeType,
                    name: `files/${path.basename(file)}`,
                };
            },
        },
    } as unknown as any;

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'custom-model');
    const originalLog = console.log;
    try {
        console.log = () => { };
        const result = await analyzer.analyzeImages(
            [
                {
                    type: 'local',
                    data: tempPath,
                    mimeType: 'image/png',
                },
            ],
            'please describe',
        );

        assert.equal(result, 'analysis result');
        assert.equal(recordedModel, 'custom-model');
        assert.equal(uploaded.length, 1);
        assert.equal(uploaded[0]?.file, path.resolve(tempPath));
        assert.equal(uploaded[0]?.mimeType, 'image/png');
        assert.equal(uploaded[0]?.displayName, undefined);

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.role, 'user');
        assert.equal(firstContent?.parts?.[0]?.text, 'please describe');
        assert.equal(firstContent?.parts?.[1]?.fileData?.fileUri, `files/${path.basename(tempPath)}`);
        assert.equal(firstContent?.parts?.[1]?.fileData?.mimeType, 'image/png');
        assert.equal(firstContent?.parts?.[1]?.fileData?.displayName, undefined);
        assert.equal(
            Object.prototype.hasOwnProperty.call(firstContent?.parts?.[1]?.fileData ?? {}, 'displayName'),
            false,
        );
    } finally {
        console.log = originalLog;
        await fs.rm(tempPath, { force: true });
    }
});

test('analyzeImages accepts file:// URIs for local inputs', async () => {
    const tempPath = path.join(os.tmpdir(), `gemini-media-uri-${crypto.randomUUID()}.jpg`);
    await fs.writeFile(tempPath, Buffer.from('uri-image-data'));

    const uploaded: Array<{ file: string; mimeType?: string }> = [];
    let recordedContents: unknown;

    const fakeClient = {
        models: {
            async generateContent({ contents }: { contents: unknown }) {
                recordedContents = contents;
                return { text: 'uri analysis' };
            },
        },
        files: {
            async upload({ file, config }: { file: string; config?: { mimeType?: string } }) {
                uploaded.push({ file, mimeType: config?.mimeType });
                return {
                    uri: `files/${path.basename(file)}`,
                    name: `files/${path.basename(file)}`,
                    mimeType: config?.mimeType,
                    state: 'ACTIVE',
                };
            },
        },
    } as unknown as any;

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'uri-model');
    const originalLog = console.log;

    try {
        console.log = () => { };
        const fileUri = pathToFileURL(tempPath).toString();
        const result = await analyzer.analyzeImages(
            [
                {
                    type: 'local',
                    data: fileUri,
                    mimeType: 'image/jpeg',
                },
            ],
            'describe uri image',
        );

        assert.equal(result, 'uri analysis');
        assert.equal(uploaded.length, 1);
        assert.equal(uploaded[0]?.file, path.resolve(tempPath));
        assert.equal(uploaded[0]?.mimeType, 'image/jpeg');

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.parts?.[1]?.fileData?.fileUri, `files/${path.basename(tempPath)}`);
    } finally {
        console.log = originalLog;
        await fs.rm(tempPath, { force: true });
    }
});

test('analyzeImages uploads remote URL content via Gemini Files API', async () => {
    const remoteUrl = 'https://example.com/sample-image.png';
    const buffer = Buffer.from('remote-image-data');

    let recordedModel: string | undefined;
    let recordedContents: unknown;
    const uploaded: Array<{ file: string; mimeType?: string; displayName?: string }> = [];

    const fakeClient = {
        models: {
            async generateContent({ model, contents }: { model: string; contents: unknown }) {
                recordedModel = model;
                recordedContents = contents;
                return {
                    text: 'analysis result',
                };
            },
        },
        files: {
            async upload({ file, config }: { file: string; config?: { mimeType?: string; displayName?: string } }) {
                uploaded.push({ file, mimeType: config?.mimeType, displayName: config?.displayName });
                return {
                    uri: `files/${path.basename(file)}`,
                    mimeType: config?.mimeType,
                    name: `files/${path.basename(file)}`,
                };
            },
        },
    } as unknown as any;

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'remote-model');
    const originalAxiosGet = axios.get;
    const originalLog = console.log;

    try {
        (axios as any).get = async (url: string) => {
            assert.equal(url, remoteUrl);
            return {
                data: buffer,
                headers: { 'content-type': 'image/png' },
            };
        };

        console.log = () => { };
        const result = await analyzer.analyzeImages([
            {
                type: 'url',
                data: remoteUrl,
            },
        ]);

        assert.equal(result, 'analysis result');
        assert.equal(recordedModel, 'remote-model');
        assert.equal(uploaded.length, 1);
        assert.ok(typeof uploaded[0]?.file === 'string');
        assert.ok(path.isAbsolute(uploaded[0]?.file ?? ''));
        assert.equal(uploaded[0]?.mimeType, 'image/png');
        assert.equal(uploaded[0]?.displayName, undefined);

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.role, 'user');
        assert.equal(firstContent?.parts?.[1]?.fileData?.mimeType, 'image/png');
        assert.equal(firstContent?.parts?.[1]?.fileData?.displayName, undefined);
        assert.equal(
            Object.prototype.hasOwnProperty.call(firstContent?.parts?.[1]?.fileData ?? {}, 'displayName'),
            false,
        );
    } finally {
        console.log = originalLog;
        (axios as any).get = originalAxiosGet;
    }
});

test('analyzeImages resolves relative paths using MCP_MEDIA_BASE_DIRS', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), `gemini-media-rel-${crypto.randomUUID()}`));
    const relativePath = path.join('nested', 'relative-image.png');
    const absolutePath = path.join(baseDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from('relative-image-data'));

    const uploaded: Array<{ file: string; mimeType?: string }> = [];
    let recordedContents: unknown;

    const fakeClient = {
        models: {
            async generateContent({ contents }: { contents: unknown }) {
                recordedContents = contents;
                return { text: 'relative analysis' };
            },
        },
        files: {
            async upload({ file, config }: { file: string; config?: { mimeType?: string } }) {
                uploaded.push({ file, mimeType: config?.mimeType });
                return {
                    uri: `files/${path.basename(file)}`,
                    mimeType: config?.mimeType,
                    name: `files/${path.basename(file)}`,
                };
            },
        },
    } as unknown as any;

    const previousEnv = process.env.MCP_MEDIA_BASE_DIRS;
    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'relative-model');
    const originalLog = console.log;

    try {
        process.env.MCP_MEDIA_BASE_DIRS = baseDir;
        console.log = () => { };
        const result = await analyzer.analyzeImages(
            [
                {
                    type: 'local',
                    data: relativePath,
                    mimeType: 'image/png',
                },
            ],
            'describe relative image',
        );

        assert.equal(result, 'relative analysis');
        assert.equal(uploaded.length, 1);
        assert.equal(uploaded[0]?.file, path.resolve(absolutePath));
        assert.equal(uploaded[0]?.mimeType, 'image/png');

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.parts?.[0]?.text, 'describe relative image');
        assert.equal(firstContent?.parts?.[1]?.fileData?.fileUri, `files/${path.basename(absolutePath)}`);
    } finally {
        console.log = originalLog;
        if (previousEnv === undefined) {
            delete process.env.MCP_MEDIA_BASE_DIRS;
        } else {
            process.env.MCP_MEDIA_BASE_DIRS = previousEnv;
        }
        await fs.rm(baseDir, { recursive: true, force: true });
    }
});

test('analyzeImages waits for Gemini Files API to finish processing uploaded files', async () => {
    const tempPath = path.join(os.tmpdir(), `gemini-media-poll-${crypto.randomUUID()}.png`);
    await fs.writeFile(tempPath, Buffer.from('poll-image-data'));

    let recordedModel: string | undefined;
    let recordedContents: unknown;
    const uploaded: Array<{ file: string; mimeType?: string }> = [];
    const pollResponses: Array<string | undefined> = [];
    let getCallCount = 0;

    const fakeClient = {
        models: {
            async generateContent({ model, contents }: { model: string; contents: unknown }) {
                recordedModel = model;
                recordedContents = contents;
                return { text: 'poll analysis' };
            },
        },
        files: {
            async upload({ file, config }: { file: string; config?: { mimeType?: string } }) {
                uploaded.push({ file, mimeType: config?.mimeType });
                return {
                    uri: `files/${path.basename(file)}`,
                    name: `files/${path.basename(file)}`,
                    mimeType: config?.mimeType,
                    state: 'PROCESSING',
                    error: null,
                };
            },
            async get({ name }: { name: string }) {
                getCallCount += 1;
                pollResponses.push(name);
                const state = getCallCount === 1 ? 'PROCESSING' : 'ACTIVE';
                return {
                    uri: `files/${path.basename(tempPath)}`,
                    name,
                    mimeType: 'image/png',
                    state,
                    error: null,
                };
            },
        },
    } as unknown as any;

    const previousInterval = process.env.GEMINI_FILE_POLL_INTERVAL_MS;
    process.env.GEMINI_FILE_POLL_INTERVAL_MS = '0';

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'poll-model');
    const originalLog = console.log;

    try {
        console.log = () => { };
        const result = await analyzer.analyzeImages(
            [
                {
                    type: 'local',
                    data: tempPath,
                    mimeType: 'image/png',
                },
            ],
            'poll prompt',
        );

        assert.equal(result, 'poll analysis');
        assert.equal(recordedModel, 'poll-model');
        assert.equal(uploaded.length, 1);
        assert.equal(getCallCount, 2);
        assert.deepEqual(pollResponses, [
            `files/${path.basename(tempPath)}`,
            `files/${path.basename(tempPath)}`,
        ]);

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.parts?.[1]?.fileData?.fileUri, `files/${path.basename(tempPath)}`);
    } finally {
        console.log = originalLog;
        if (previousInterval === undefined) {
            delete process.env.GEMINI_FILE_POLL_INTERVAL_MS;
        } else {
            process.env.GEMINI_FILE_POLL_INTERVAL_MS = previousInterval;
        }
        await fs.rm(tempPath, { force: true });
    }
});

test('analyzeVideos uploads local files with Gemini Files API', async () => {
    const tempPath = path.join(os.tmpdir(), `gemini-media-${crypto.randomUUID()}.mp4`);
    await fs.writeFile(tempPath, Buffer.from('test-video-data'));

    let recordedModel: string | undefined;
    let recordedContents: unknown;
    const uploaded: Array<{ file: string; mimeType?: string; displayName?: string }> = [];

    const fakeClient = {
        models: {
            async generateContent({ model, contents }: { model: string; contents: unknown }) {
                recordedModel = model;
                recordedContents = contents;
                return {
                    text: 'video analysis result',
                };
            },
        },
        files: {
            async upload({ file, config }: { file: string; config?: { mimeType?: string; displayName?: string } }) {
                uploaded.push({ file, mimeType: config?.mimeType, displayName: config?.displayName });
                return {
                    uri: `files/${path.basename(file)}`,
                    mimeType: config?.mimeType,
                    name: `files/${path.basename(file)}`,
                };
            },
        },
    } as unknown as any;

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'video-model');
    const originalLog = console.log;

    try {
        console.log = () => { };
        const result = await analyzer.analyzeVideos(
            [
                {
                    type: 'local',
                    data: tempPath,
                    mimeType: 'video/mp4',
                },
            ],
            'summarise video',
        );

        assert.equal(result, 'video analysis result');
        assert.equal(recordedModel, 'video-model');
        assert.equal(uploaded.length, 1);
        assert.equal(uploaded[0]?.file, path.resolve(tempPath));
        assert.equal(uploaded[0]?.mimeType, 'video/mp4');
        assert.equal(uploaded[0]?.displayName, undefined);

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.role, 'user');
        assert.equal(firstContent?.parts?.[0]?.text, 'summarise video');
        assert.equal(firstContent?.parts?.[1]?.fileData?.fileUri, `files/${path.basename(tempPath)}`);
        assert.equal(firstContent?.parts?.[1]?.fileData?.mimeType, 'video/mp4');
        assert.equal(firstContent?.parts?.[1]?.fileData?.displayName, undefined);
        assert.equal(
            Object.prototype.hasOwnProperty.call(firstContent?.parts?.[1]?.fileData ?? {}, 'displayName'),
            false,
        );
    } finally {
        console.log = originalLog;
        await fs.rm(tempPath, { force: true });
    }
});

test('analyzeVideos sends YouTube sources without using the Files API', async () => {
    let recordedModel: string | undefined;
    let recordedContents: unknown;
    let uploadCalled = false;

    const fakeClient = {
        models: {
            async generateContent({ model, contents }: { model: string; contents: unknown }) {
                recordedModel = model;
                recordedContents = contents;
                return {
                    text: 'youtube analysis',
                };
            },
        },
        files: {
            async upload() {
                uploadCalled = true;
                throw new Error('files.upload should not be called for YouTube sources');
            },
        },
    } as unknown as any;

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'youtube-model');
    const originalLog = console.log;

    try {
        console.log = () => { };
        const result = await analyzer.analyzeVideos(
            [
                {
                    type: 'youtube',
                    data: 'https://www.youtube.com/watch?v=9hE5-98ZeCg',
                },
            ],
            'summarise youtube video',
        );

        assert.equal(result, 'youtube analysis');
        assert.equal(recordedModel, 'youtube-model');
        assert.equal(uploadCalled, false);

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.parts?.[1]?.fileData?.fileUri, 'https://www.youtube.com/watch?v=9hE5-98ZeCg');
        assert.equal(firstContent?.parts?.[1]?.fileData?.mimeType, 'video/*');
    } finally {
        console.log = originalLog;
    }
});

test('analyzeImages throws when local file is missing', async () => {
    let uploadCalled = false;
    const fakeClient = {
        models: {
            async generateContent() {
                throw new Error('generateContent should not be called when file is missing');
            },
        },
        files: {
            async upload() {
                uploadCalled = true;
                throw new Error('upload should not be invoked when file lookup fails');
            },
        },
    } as unknown as any;

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'any-model');

    await assert.rejects(
        analyzer.analyzeImages([
            {
                type: 'local',
                data: path.join(os.tmpdir(), 'non-existent-file.png'),
                mimeType: 'image/png',
            },
        ]),
        /Failed to access image file/i,
    );

    assert.equal(uploadCalled, false, 'files.upload should not be called if the file is missing');
});
