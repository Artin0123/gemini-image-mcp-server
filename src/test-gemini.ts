#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

import {
  GeminiMediaAnalyzer,
  UrlImageSource,
  LocalImageSource,
  UrlVideoSource,
  LocalVideoSource,
  YouTubeVideoSource,
  supportedVideoMimeTypes,
} from './gemini-media.js';
import { DEFAULT_MODEL_NAME } from './server-config.js';

dotenvConfig();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required in .env file');
  process.exit(1);
}

const modelName =
  process.env.GEMINI_MODEL ??
  process.env.TEST_GEMINI_MODEL ??
  DEFAULT_MODEL_NAME;

const analyzer = new GeminiMediaAnalyzer(new GoogleGenAI({ apiKey: GEMINI_API_KEY }), modelName);

const DEFAULT_IMAGE_URL =
  process.env.SAMPLE_IMAGE_URL ?? 'https://storage.googleapis.com/generativeai-downloads/images/scones.jpg';
const DEFAULT_VIDEO_URL =
  process.env.SAMPLE_VIDEO_URL ?? 'https://storage.googleapis.com/generativeai-downloads/videos/Big_Buck_Bunny.mp4';
const DEFAULT_YOUTUBE_URL =
  process.env.SAMPLE_YOUTUBE_URL ?? 'https://www.youtube.com/watch?v=9hE5-98ZeCg';

type AnyVideoSource = UrlVideoSource | LocalVideoSource | YouTubeVideoSource;

function readLocalImage(imagePath: string): LocalImageSource | null {
  const resolvedPath = path.resolve(imagePath);

  if (!fs.existsSync(resolvedPath)) {
    console.warn(`Local image not found: ${resolvedPath}. Skipping.`);
    return null;
  }

  try {
    const lookupType = mime.lookup(resolvedPath);
    const mimeType = typeof lookupType === 'string' ? lookupType : 'application/octet-stream';

    if (!mimeType.startsWith('image/')) {
      console.warn(`Local file is not an image: ${resolvedPath} (MIME: ${mimeType}). Skipping.`);
      return null;
    }

    return {
      type: 'local',
      data: resolvedPath,
      mimeType,
    };
  } catch (error) {
    console.error(`Error reading local image ${resolvedPath}:`, error);
    return null;
  }
}

function readLocalVideo(videoPath: string): LocalVideoSource | null {
  const resolvedPath = path.resolve(videoPath);

  if (!fs.existsSync(resolvedPath)) {
    console.warn(`Local video not found: ${resolvedPath}. Skipping.`);
    return null;
  }

  try {
    const lookupType = mime.lookup(resolvedPath);
    const detectedMimeType = typeof lookupType === 'string' ? lookupType : 'application/octet-stream';
    const finalMimeType = mapVideoMimeType(detectedMimeType);

    if (!isSupportedVideoMimeType(finalMimeType)) {
      console.warn(
        `Local video has unsupported MIME type: ${detectedMimeType} (mapped to ${finalMimeType}). Skipping ${resolvedPath}.`
      );
      return null;
    }

    return {
      type: 'local',
      data: resolvedPath,
      mimeType: finalMimeType,
    };
  } catch (error) {
    console.error(`Error reading local video ${resolvedPath}:`, error);
    return null;
  }
}

function mapVideoMimeType(mimeType: string): string {
  const lowered = mimeType.toLowerCase();

  if (lowered === 'application/mp4') {
    return 'video/mp4';
  }

  if (lowered === 'video/wmv') {
    return 'video/x-ms-wmv';
  }

  if (lowered === 'video/avi') {
    return 'video/x-msvideo';
  }

  if (lowered === 'video/mov') {
    return 'video/quicktime';
  }

  if (lowered === 'video/mpg') {
    return 'video/mpeg';
  }

  return lowered;
}

function isSupportedVideoMimeType(
  mimeType: string
): mimeType is (typeof supportedVideoMimeTypes)[number] {
  return (supportedVideoMimeTypes as readonly string[]).includes(mimeType.toLowerCase());
}

async function run(): Promise<void> {
  const imageSources: (UrlImageSource | LocalImageSource)[] = [
    {
      type: 'url',
      data: DEFAULT_IMAGE_URL,
    },
  ];

  const localImagePath = process.env.TEST_IMAGE_PATH ?? process.argv[2];
  if (localImagePath) {
    const localImage = readLocalImage(localImagePath);
    if (localImage) {
      imageSources.push(localImage);
    }
  }

  console.log('Analyzing image sources...');
  const imageAnalysis = await analyzer.analyzeImages(
    imageSources,
    process.env.IMAGE_PROMPT ?? 'Provide a concise description of the visuals.'
  );
  console.log('\n--- Image Analysis ---');
  console.log(imageAnalysis);

  const videoSources: AnyVideoSource[] = [
    {
      type: 'youtube',
      data: DEFAULT_YOUTUBE_URL,
    },
  ];

  const remoteVideoUrl = process.env.TEST_VIDEO_URL ?? DEFAULT_VIDEO_URL;
  if (remoteVideoUrl) {
    videoSources.push({ type: 'url', data: remoteVideoUrl });
  }

  const localVideoPath = process.env.TEST_VIDEO_PATH ?? process.argv[3];
  if (localVideoPath) {
    const localVideo = readLocalVideo(localVideoPath);
    if (localVideo) {
      videoSources.push(localVideo);
    }
  }

  console.log('\nAnalyzing video sources...');
  const videoAnalysis = await analyzer.analyzeVideos(
    videoSources,
    process.env.VIDEO_PROMPT ?? 'Summarize the key events in these videos.'
  );
  console.log('\n--- Video Analysis ---');
  console.log(videoAnalysis);
}

run().catch((error) => {
  console.error('Gemini media tests failed:', error);
  process.exit(1);
});
