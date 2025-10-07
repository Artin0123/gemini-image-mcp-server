import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadServerOptions,
    DEFAULT_MODEL_NAME,
} from '../src/server-config.js';

test('loadServerOptions honours environment model override', () => {
    const env: NodeJS.ProcessEnv = {
        GEMINI_MODEL: 'gemini-flash-lite-latest',
    };

    const options = loadServerOptions(env);

    assert.equal(options.modelName, 'gemini-flash-lite-latest');
});

test('loadServerOptions falls back to default model when unset', () => {
    const options = loadServerOptions({});

    assert.equal(options.modelName, DEFAULT_MODEL_NAME);
});
