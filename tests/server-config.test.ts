import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import {
    resolveLocalPath,
    loadServerOptions,
    DEFAULT_MODEL_NAME,
} from '../src/server-config.js';

test('resolveLocalPath resolves relative paths within the current working directory', (t) => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-mcp-'));
    const testImagePath = path.join(tempDir, 'test.png');
    fs.writeFileSync(testImagePath, Buffer.from([0xff]));

    process.chdir(tempDir);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const resolved = resolveLocalPath('test.png');
    assert.ok(resolved, 'Relative path should resolve to an absolute location');
    assert.equal(resolved, path.normalize(testImagePath));
});

test('resolveLocalPath supports file:// URLs', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-mcp-'));
    const filePath = path.join(tempDir, 'sample.png');
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
        const fileUrl = pathToFileURL(filePath);
        const resolved = resolveLocalPath(fileUrl.toString());
        assert.ok(resolved, 'File URL should resolve to a local path');
        assert.equal(resolved, path.normalize(filePath));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('loadServerOptions honours environment overrides and sanitises tool names', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-mcp-'));

    try {
        const env: NodeJS.ProcessEnv = {
            GEMINI_MODEL: 'gemini-flash-lite-latest',
            MCP_DISABLED_TOOLS: 'analyze_video,UNKNOWN_TOOL',
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
            assert.ok(options.disabledTools.has('analyze_video'));
            assert.equal(warnings.length, 1);
        } finally {
            console.warn = originalWarn;
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('loadServerOptions falls back to default model when unset', () => {
    const options = loadServerOptions({});

    assert.equal(options.modelName, DEFAULT_MODEL_NAME);
});
