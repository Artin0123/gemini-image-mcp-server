import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadServerOptions,
    DEFAULT_MODEL_NAME,
    MODEL_ENV_VAR,
    normalizeModelName,
} from '../src/server-config.js';

test('loadServerOptions honours environment model override', () => {
    const env: NodeJS.ProcessEnv = {
        [MODEL_ENV_VAR]: 'gemini-flash-lite-latest',
    };

    const options = loadServerOptions(env);

    assert.equal(options.modelName, 'models/gemini-flash-lite-latest');
});

test('loadServerOptions falls back to default model when unset', () => {
    const options = loadServerOptions({});

    assert.equal(options.modelName, DEFAULT_MODEL_NAME);
});

test('normalizeModelName adds models prefix as needed', () => {
    assert.equal(normalizeModelName(' models/gemini-pro '), 'models/gemini-pro');
    assert.equal(normalizeModelName('gemini-1.5-pro'), 'models/gemini-1.5-pro');
    assert.equal(normalizeModelName(''), DEFAULT_MODEL_NAME);
});
