import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadServerOptions,
    DEFAULT_MODEL_NAME,
} from '../src/server-config.js';

test('loadServerOptions honours environment overrides and sanitises tool names', () => {
    const env: NodeJS.ProcessEnv = {
        GEMINI_MODEL: 'gemini-flash-lite-latest',
        MCP_DISABLED_TOOLS: 'analyze_video_local,analyze_video_inline,UNKNOWN_TOOL',
    };

    const originalWarn = console.warn;
    const warnings: Array<string | unknown> = [];

    console.warn = (...args: Array<string | unknown>) => {
        warnings.push(args.join(' '));
    };

    try {
        const options = loadServerOptions(env);

        assert.equal(options.modelName, 'gemini-flash-lite-latest');
        assert.equal(options.disabledTools.size, 1);
        assert.ok(options.disabledTools.has('analyze_video_local'));
        assert.equal(warnings.length, 2);
    } finally {
        console.warn = originalWarn;
    }
});

test('loadServerOptions falls back to default model when unset', () => {
    const options = loadServerOptions({});

    assert.equal(options.modelName, DEFAULT_MODEL_NAME);
});
