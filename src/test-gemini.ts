import { OpenAI } from "openai";
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import axios from 'axios';

// Load environment variables from .env file
dotenv.config();

// Get Gemini API key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required in .env file');
  process.exit(1);
}

// Initialize OpenAI client for Gemini
const openai = new OpenAI({
  apiKey: GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

// --- Copy of the analyzeImageWithGemini function ---
async function analyzeImageWithGemini(
   imageData: { type: 'url', data: string } | { type: 'base64', data: string, mimeType: string }
 ): Promise<string> {
  try {
    let imageInput: any;
    let finalMimeType: string;
    let base64String: string;

    if (imageData.type === 'url') {
      console.log(`Fetching image from URL: ${imageData.data}`);
      const response = await axios.get(imageData.data, { responseType: 'arraybuffer' });
      base64String = Buffer.from(response.data, 'binary').toString('base64');
      finalMimeType = response.headers['content-type']?.split(';')[0] || mime.lookup(imageData.data) || 'application/octet-stream'; // Get MIME type from header or URL

      if (!finalMimeType.startsWith('image/')) {
        throw new Error(`Fetched content is not an image: ${finalMimeType}`);
      }
      console.log(`Analyzing fetched image from URL (MIME: ${finalMimeType})...`);

    } else {
      console.log(`Analyzing image from base64 data (MIME: ${imageData.mimeType})...`);
      base64String = imageData.data;
      finalMimeType = imageData.mimeType;
    }

    // Construct data URI for OpenAI API compatibility layer
    imageInput = { type: 'image_url', image_url: { url: `data:${finalMimeType};base64,${base64String}` } };


    const response = await openai.chat.completions.create({
      model: 'gemini-2.0-flash', // Using gemini-2.0-flash as in your original code
      messages: [
        {
          role: 'system',
          content: 'Analyze the image content in detail and provide an explanation in English.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Please analyze the following image and explain its content in detail.' },
            imageInput, // Use the constructed image input
          ],
        },
      ],
      max_tokens: 500, // Reduced tokens for testing
    });

    const analysis = response.choices[0]?.message?.content || 'Could not retrieve analysis results.';
    console.log("--- Analysis Result ---");
    console.log(analysis);
    console.log("-----------------------");
    return analysis;

  } catch (error) {
    console.error('Gemini API call error:', error);
    throw new Error(`Gemini API error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
// --- End of copied function ---


// --- Main test execution ---
async function runTests() {
  console.log("Starting Gemini API tests...");

  // Test 1: Analyze image from a public URL
  // Replace with a valid public image URL if needed
  const testImageUrl = 'https://cdn.dribbble.com/userupload/33843543/file/original-519f69a4cddade44b398bedeb3bbdb4e.jpg?resize=2400x1017&vertical=center'; // Example URL
  try {
    await analyzeImageWithGemini({ type: 'url', data: testImageUrl });
  } catch (e) {
    console.error("Error analyzing URL image:", e);
  }

  console.log("\nWaiting a moment before next test...\n");
  await new Promise(resolve => setTimeout(resolve, 2000)); // Small delay

  // Test 2: Analyze image from a local file path
  const localImagePath = 'test-image.png'; // <-- Make sure this image exists in your project root!
  try {
    if (!fs.existsSync(localImagePath)) {
      console.error(`Local test image not found at: ${path.resolve(localImagePath)}. Skipping local image test.`);
      return;
    }
    const imageDataBuffer = fs.readFileSync(localImagePath);
    const base64String = imageDataBuffer.toString('base64');
    const mimeType = mime.lookup(localImagePath) || 'image/jpeg'; // Default to jpeg if lookup fails

    if (!mimeType.startsWith('image/')) {
       console.error(`File is not an image: ${mimeType}`);
       return;
    }

    await analyzeImageWithGemini({ type: 'base64', data: base64String, mimeType: mimeType });

  } catch (e) {
    console.error("Error analyzing local image:", e);
  }

   console.log("\nGemini API tests finished.");
}

runTests();
