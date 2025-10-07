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

test('GeminiMediaAnalyzer uses correct model name', async () => {
    const fake = createFakeClient();
    const analyzer = new GeminiMediaAnalyzer(fake.client as any, 'test-model-name');
    const originalLog = console.log;
    console.log = noop;

    try {
        await analyzer.analyzeYouTubeVideo('https://www.youtube.com/watch?v=test', 'test prompt');
        assert.equal(fake.model, 'test-model-name');
    } finally {
        console.log = originalLog;
    }
});

test('analyzeYouTubeVideo handles YouTube URLs', async () => {
    const youtubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const fake = createFakeClient();
    const analyzer = new GeminiMediaAnalyzer(fake.client as any, 'video-model');
    const originalLog = console.log;
    console.log = noop;

    try {
        const result = await analyzer.analyzeYouTubeVideo(youtubeUrl, 'describe video');

        assert.equal(result, 'ok');
        const firstContent = fake.contents?.[0];
        assert.equal(firstContent?.role, 'user');
        assert.equal(firstContent?.parts?.[0]?.text, 'describe video');

        const filePart = firstContent?.parts?.[1];
        assert.equal(filePart?.fileData?.fileUri, youtubeUrl);
        assert.equal(filePart?.fileData?.mimeType, 'video/*');
    } finally {
        console.log = originalLog;
    }
});
