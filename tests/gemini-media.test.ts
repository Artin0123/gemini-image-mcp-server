import test from 'node:test';
import assert from 'node:assert/strict';
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
        assert.equal(filePart?.fileData?.mimeType, 'image/*');
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
        assert.equal(filePart?.fileData?.mimeType, 'video/*');
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
