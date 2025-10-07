import test from 'node:test';
import assert from 'node:assert/strict';
import { configSchema, createGeminiMcpServer } from '../src/index.js';

test('configSchema validates and trims API key', () => {
    const result = configSchema.parse({
        geminiApiKey: '  test-key  ',
        modelName: '  gemini-pro  ',
    });

    assert.equal(result.geminiApiKey, 'test-key');
    assert.equal(result.modelName, 'gemini-pro');
});

test('configSchema rejects empty API key', () => {
    assert.throws(() => configSchema.parse({ geminiApiKey: '' }));
    assert.throws(() => configSchema.parse({ geminiApiKey: '   ' }));
});

test('createGeminiMcpServer initializes with correct configuration schema', () => {
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
                description:
                    'Optional Gemini model name override. Defaults to models/gemini-flash-lite-latest.',
            },
        },
        required: [],
    });
});

test('createGeminiMcpServer registers all tools', () => {
    const server = createGeminiMcpServer({
        config: { geminiApiKey: 'test-key' },
    });

    const tools = (server as any)._registeredTools;
    assert.ok(tools['analyze_image']);
    assert.ok(tools['analyze_youtube_video']);
});
