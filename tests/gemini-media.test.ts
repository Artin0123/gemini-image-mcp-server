import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { GeminiMediaAnalyzer } from '../src/gemini-media.js';

const noop = () => { };

function createFakeClient() {
    let recordedParams: { model?: string; contents?: unknown } | undefined;

    return {
        recordedParams,
        client: {
            models: {
                async generateContent(params: { model: string; contents: unknown }) {
                    recordedParams = params;
                    return { text: 'ok' };
                },
            },
        },
        get contents() {
            return recordedParams?.contents as Array<any> | undefined;
        },
        get model() {
            return recordedParams?.model;
        },
    } as const;
}

test('analyzeImageUrls forwards URL references to Gemini', async () => {
    const remoteUrl = 'https://example.com/sample-image.png';

    const fake = createFakeClient();
    const analyzer = new GeminiMediaAnalyzer(fake.client as any, 'image-model');
    const originalLog = console.log;

    try {
        console.log = noop;

        const result = await analyzer.analyzeImageUrls([remoteUrl], 'describe image');

        assert.equal(result, 'ok');
        assert.equal(fake.model, 'image-model');
        const contents = fake.contents;
        assert.ok(Array.isArray(contents));
        const firstContent = contents?.[0];
        assert.equal(firstContent?.role, 'user');
        assert.equal(firstContent?.parts?.[0]?.text, 'describe image');
        const filePart = firstContent?.parts?.[1];
        assert.equal(filePart?.fileData?.fileUri, remoteUrl);
        assert.equal(filePart?.fileData?.mimeType, 'image/png');
    } finally {
        console.log = originalLog;
    }
});

test('analyzeVideoUrls forwards URL references with inferred MIME types', async () => {
    const remoteUrl = 'https://example.com/sample-video.mp4';

    const fake = createFakeClient();
    const analyzer = new GeminiMediaAnalyzer(fake.client as any, 'video-model');
    const originalLog = console.log;

    try {
        console.log = noop;

        const result = await analyzer.analyzeVideoUrls([remoteUrl], 'describe video');

        assert.equal(result, 'ok');
        const firstContent = fake.contents?.[0];
        const filePart = firstContent?.parts?.[1];
        assert.equal(filePart?.fileData?.fileUri, remoteUrl);
        assert.equal(filePart?.fileData?.mimeType, 'video/mp4');
    } finally {
        console.log = originalLog;
    }
});

test('analyzeImages supports base64 image sources with inferred MIME types', async () => {
    const base64Payload = Buffer.from('hello world').toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Payload}`;
    const fake = createFakeClient();
    const analyzer = new GeminiMediaAnalyzer(fake.client as any, 'image-model');
    const originalLog = console.log;

    try {
        console.log = noop;

        const result = await analyzer.analyzeImages(
            [
                { type: 'base64', data: base64Payload, mimeType: 'image/gif' },
                { type: 'base64', data: dataUrl },
            ],
            'describe image',
        );

        assert.equal(result, 'ok');
        const firstContent = fake.contents?.[0];
        const inlinePartA = firstContent?.parts?.[1];
        const inlinePartB = firstContent?.parts?.[2];
        assert.equal(inlinePartA?.inlineData?.mimeType, 'image/gif');
        assert.equal(inlinePartA?.inlineData?.data, base64Payload);
        assert.equal(inlinePartB?.inlineData?.mimeType, 'image/jpeg');
        assert.equal(inlinePartB?.inlineData?.data, base64Payload);
    } finally {
        console.log = originalLog;
    }
});

test('analyzeYouTubeVideo forwards file data reference for YouTube URLs', async () => {
    const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const fake = createFakeClient();
    const analyzer = new GeminiMediaAnalyzer(fake.client as any, 'video-model');
    const originalLog = console.log;

    try {
        console.log = noop;

        const result = await analyzer.analyzeYouTubeVideo(youtubeUrl, 'describe youtube');

        assert.equal(result, 'ok');
        const firstContent = fake.contents?.[0];
        const filePart = firstContent?.parts?.[1];
        assert.equal(filePart?.fileData?.fileUri, youtubeUrl);
        assert.equal(filePart?.fileData?.mimeType, 'video/*');
    } finally {
        console.log = originalLog;
    }
});
