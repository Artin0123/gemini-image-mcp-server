import test from 'node:test';
import assert from 'node:assert/strict';
import type { GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiMediaAnalyzer, Base64ImageSource } from '../src/gemini-media.js';

test('analyzeImages forwards prompt text and inline image data to the Gemini model', async () => {
    let recordedModel: string | undefined;
    let recordedContents: unknown;

    const fakeClient = {
        getGenerativeModel({ model }: { model: string }) {
            recordedModel = model;
            return {
                async generateContent({ contents }: { contents: unknown }) {
                    recordedContents = contents;
                    return {
                        response: {
                            candidates: [
                                {
                                    content: {
                                        parts: [
                                            {
                                                text: 'analysis result',
                                            },
                                        ],
                                    },
                                    finishReason: 'STOP',
                                },
                            ],
                        },
                    };
                },
            };
        },
    } as unknown as GoogleGenerativeAI;

    const analyzer = new GeminiMediaAnalyzer(fakeClient, 'custom-model');
    const imageSource: Base64ImageSource = {
        type: 'base64',
        data: Buffer.from('hello world').toString('base64'),
        mimeType: 'image/png',
    };

    const originalLog = console.log;
    try {
        console.log = () => { };
        const result = await analyzer.analyzeImages([imageSource], 'please describe');

        assert.equal(result, 'analysis result');
        assert.equal(recordedModel, 'custom-model');
        assert.ok(Array.isArray(recordedContents), 'Gemini request should contain an array of contents');

        const firstContent = (recordedContents as Array<any>)[0];
        assert.equal(firstContent?.role, 'user');
        assert.equal(firstContent?.parts?.[0]?.text, 'please describe');
        assert.equal(firstContent?.parts?.[1]?.inlineData?.mimeType, 'image/png');
        assert.ok(firstContent?.parts?.[1]?.inlineData?.data, 'Inline image data should be present');
    } finally {
        console.log = originalLog;
    }
});
