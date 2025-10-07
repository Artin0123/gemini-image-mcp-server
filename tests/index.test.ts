import test from 'node:test';
import assert from 'node:assert/strict';
import { configSchema, createGeminiMcpServer } from '../src/index.js';
import { GeminiMediaAnalyzer } from '../src/gemini-media.js';

test('configSchema trims and validates entries', () => {
    const result = configSchema.parse({
        geminiApiKey: '  key  ',
        modelName: '  gemini-pro  ',
    });

    assert.equal(result.geminiApiKey, 'key');
    assert.equal(result.modelName, 'gemini-pro');

    assert.throws(() => configSchema.parse({ geminiApiKey: '' }));
});

test('createGeminiMcpServer exposes configuration schema metadata', () => {
    const server = createGeminiMcpServer({ config: {} });
    const serverInfo = (server.server as any)._serverInfo;

    assert.deepEqual(serverInfo?.configuration?.schema, {
        type: 'object',
        additionalProperties: false,
        properties: {
            geminiApiKey: {
                type: 'string',
                description:
                    'Your Google Gemini API key for image and video analysis. Falls back to GEMINI_API_KEY when omitted.',
            },
            modelName: {
                type: 'string',
                description: 'Optional Gemini model name override. Defaults to gemini-flash-lite-latest.',
            },
        },
        required: [],
    });
});

test('analyze_image tool enforces schema and uses provided config', async () => {
    const original = GeminiMediaAnalyzer.prototype.analyzeImageUrls;
    const calls: Array<{ urls: string[]; prompt?: string; modelName?: string }> = [];
    GeminiMediaAnalyzer.prototype.analyzeImageUrls = async function (urls, prompt) {
        calls.push({ urls, prompt, modelName: (this as any).modelName });
        return 'stubbed-response';
    };

    try {
        const server = createGeminiMcpServer({
            config: {
                geminiApiKey: 'cfg-key',
                modelName: 'gemini-pro-vision',
            },
        });

        const tool = (server as any)._registeredTools['analyze_image'];
        const success = await tool.callback(
            {
                imageUrls: ['https://example.com/image.png'],
                prompt: 'describe image',
            },
            {} as any,
        );

        assert.equal(success.content[0].text, 'stubbed-response');
        assert.deepEqual(calls[0]?.urls, ['https://example.com/image.png']);
        assert.equal(calls[0]?.prompt, 'describe image');
        assert.equal(calls[0]?.modelName, 'gemini-pro-vision');

        const invalid = await tool.callback({ imageUrls: [] }, {} as any);
        assert.equal(invalid.isError, true);
        assert.match(invalid.content[0].text, /Provide at least one image URL to analyze/);
    } finally {
        GeminiMediaAnalyzer.prototype.analyzeImageUrls = original;
    }
});

test('analyze_image tool requires API key and falls back to environment', async () => {
    const original = GeminiMediaAnalyzer.prototype.analyzeImageUrls;
    const calls: Array<{ modelName?: string }> = [];

    GeminiMediaAnalyzer.prototype.analyzeImageUrls = async function () {
        calls.push({ modelName: (this as any).modelName });
        return 'env-response';
    };

    const originalEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
        const withoutKey = createGeminiMcpServer({ config: {} });
        const tool = (withoutKey as any)._registeredTools['analyze_image'];
        const missing = await tool.callback({ imageUrls: ['https://example.com'] }, {} as any);
        assert.equal(missing.isError, true);
        assert.match(missing.content[0].text, /Gemini API key missing/);

        process.env.GEMINI_API_KEY = 'env-key';

        const server = createGeminiMcpServer({ config: {} });
        const envTool = (server as any)._registeredTools['analyze_image'];
        const success = await envTool.callback(
            { imageUrls: ['https://example.com/image.png'] },
            {} as any,
        );

        assert.equal(success.content[0].text, 'env-response');
        assert.equal(calls[0]?.modelName, 'gemini-flash-lite-latest');
    } finally {
        GeminiMediaAnalyzer.prototype.analyzeImageUrls = original;
        if (originalEnv === undefined) {
            delete process.env.GEMINI_API_KEY;
        } else {
            process.env.GEMINI_API_KEY = originalEnv;
        }
    }
});
