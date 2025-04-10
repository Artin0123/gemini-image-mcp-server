import { GoogleGenerativeAI, Content, Part } from "@google/generative-ai"; // Use Google GenAI SDK
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

// Initialize Google GenAI client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- Supported MIME types (Matching Gemini API Docs) ---
const supportedVideoMimeTypes = [
    'video/mp4', 'video/mpeg', 'video/mov', 'video/avi',
    'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp'
    // Removed 'application/mp4', 'video/quicktime' - we will map them
];

// --- analyzeImageWithGemini function (Copied & adapted from index.ts) ---
async function analyzeImageWithGemini(
    imageSources: Array<{ type: 'url', data: string } | { type: 'base64', data: string, mimeType: string }>,
    promptText: string = 'Analyze the image content in detail and provide an explanation in English.'
  ): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const imageParts: Part[] = [];
      await Promise.all(imageSources.map(async (source) => {
        let base64String: string;
        let finalMimeType: string;
        if (source.type === 'url') {
          console.log(`   Fetching image from URL: ${source.data}`);
          let fetchResponse;
          try {
            fetchResponse = await axios.get(source.data, { responseType: 'arraybuffer' });
          } catch (error) {
            const message = axios.isAxiosError(error)
              ? `Failed to fetch image URL: ${error.message} (Status: ${error.response?.status})`
              : `Failed to fetch image URL: ${error instanceof Error ? error.message : String(error)}`;
            console.error(`   ERROR: ${message}`); return;
          }
          base64String = Buffer.from(fetchResponse.data, 'binary').toString('base64');
          finalMimeType = fetchResponse.headers['content-type']?.split(';')[0] || mime.lookup(source.data) || 'application/octet-stream';
          if (!finalMimeType.startsWith('image/')) {
             console.warn(`   WARNING: Skipping non-image content from URL ${source.data}: ${finalMimeType}`); return;
          }
        } else {
          base64String = source.data;
          finalMimeType = source.mimeType;
           if (!finalMimeType.startsWith('image/')) {
             console.warn(`   WARNING: Skipping non-image base64 data (MIME: ${finalMimeType})`); return;
           }
        }
        imageParts.push({ inlineData: { data: base64String, mimeType: finalMimeType } });
      }));
      if (imageParts.length === 0) throw new Error("No valid images processed.");
      console.log(`   Sending ${imageParts.length} image(s) to Gemini with prompt: "${promptText}"`);
      const contents: Content[] = [{ role: "user", parts: [{ text: promptText }, ...imageParts] }];
      const result = await model.generateContent({ contents });
      const response = result.response;
      if (!response?.candidates?.length) throw new Error('Gemini API returned no candidates.');
      if (response.promptFeedback?.blockReason) throw new Error(`Gemini API blocked prompt: ${response.promptFeedback.blockReason}`);
      if (response.candidates[0].finishReason !== 'STOP' && response.candidates[0].finishReason !== 'MAX_TOKENS') throw new Error(`Gemini API stopped: ${response.candidates[0].finishReason}`);
      if (!response.candidates[0].content?.parts?.[0]?.text) throw new Error('Gemini API returned no text content.');
      const analysis = response.candidates[0].content.parts[0].text;
      console.log("--- Image Analysis Result ---"); console.log(analysis); console.log("---------------------------");
      return analysis;
    } catch (error) {
      console.error('Image Analysis API call error:', error);
      throw new Error(`Image Analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// --- analyzeVideoWithGemini function (Copied & adapted from index.ts) ---
async function analyzeVideoWithGemini(
    videoSources: Array<
      | { type: 'url', data: string }
      | { type: 'base64', data: string, mimeType: string }
      | { type: 'youtube', data: string }
    >,
    promptText: string = 'Analyze the video content in detail and provide an explanation in English.'
  ): Promise<string> {
    if (!Array.isArray(videoSources) || videoSources.length === 0) throw new Error("No video sources.");
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const videoParts: Part[] = [];
      await Promise.all(videoSources.map(async (source, index) => {
        if (source.type === 'youtube') {
          console.log(`   Processing YouTube URL: ${source.data}`);
          videoParts[index] = ({ fileData: { fileUri: source.data, mimeType: 'video/youtube' } }); // Added mimeType for potential future reqs
        } else {
          let base64String: string;
          let inputMimeType: string; // Use a temp variable for the initial MIME type

          if (source.type === 'url') {
            console.log(`   Fetching video from URL: ${source.data}`);
            let fetchResponse;
            try {
              // Setting a reasonable timeout for video downloads
              fetchResponse = await axios.get(source.data, { responseType: 'arraybuffer', timeout: 60000 }); // 60 sec timeout
            } catch (error) {
              const message = axios.isAxiosError(error) ? `Fetch video error: ${error.message} (Status: ${error.response?.status})` : `Fetch video error: ${error instanceof Error ? error.message : String(error)}`;
              console.error(`   ERROR: ${message}`); videoParts[index] = null as any; return; // Mark as null, filter later
            }
            base64String = Buffer.from(fetchResponse.data, 'binary').toString('base64');
            inputMimeType = fetchResponse.headers['content-type']?.split(';')[0] || mime.lookup(source.data) || 'application/octet-stream';
            console.log(`   Fetched video from URL ${source.data} (Detected MIME: ${inputMimeType}). Size: ~${(base64String.length * 0.75 / (1024*1024)).toFixed(2)} MB`);
          } else { // base64
            base64String = source.data;
            inputMimeType = source.mimeType;
            console.log(`   Processing base64 video (Detected MIME: ${inputMimeType}). Size: ~${(base64String.length * 0.75 / (1024*1024)).toFixed(2)} MB`);
          }

          // --- MIME Type Mapping ---
          let finalMimeType = inputMimeType;
          if (inputMimeType === 'application/mp4') {
              finalMimeType = 'video/mp4';
              console.log(`   Mapping MIME type application/mp4 -> video/mp4`);
          } else if (inputMimeType === 'video/quicktime') {
              finalMimeType = 'video/mov';
              console.log(`   Mapping MIME type video/quicktime -> video/mov`);
          }
          // --- End MIME Type Mapping ---

          // Validate MIME type against Gemini's supported list BEFORE adding
          if (!supportedVideoMimeTypes.includes(finalMimeType)) {
             console.warn(`   WARNING: Skipping unsupported or unmapped video MIME: ${finalMimeType} (Original: ${inputMimeType})`); videoParts[index] = null as any; return;
          }
          // Check approximate base64 size against limit (e.g., 19MB as safety margin)
          const approxSizeMB = base64String.length * 0.75 / (1024 * 1024);
          if (approxSizeMB > 19) {
             console.warn(`   WARNING: Skipping large video (~${approxSizeMB.toFixed(2)} MB > 19MB limit for inline data)`); videoParts[index] = null as any; return;
          }
          // Add the part if valid and within size limits, using finalMimeType
          videoParts[index] = ({ inlineData: { data: base64String, mimeType: finalMimeType } }); // Use finalMimeType
        }
      }));
      // Filter out parts that failed or were skipped
      const finalVideoParts = videoParts.filter(part => part !== null);
      if (finalVideoParts.length === 0) throw new Error("No valid videos processed/provided.");
      console.log(`   Sending ${finalVideoParts.length} video(s) to Gemini with prompt: "${promptText}"`);
      const contents: Content[] = [{ role: "user", parts: [{ text: promptText }, ...finalVideoParts] }];
      const result = await model.generateContent({ contents });
      const response = result.response;
      // Standard response checks
      if (!response?.candidates?.length) throw new Error('Gemini API returned no candidates.');
      if (response.promptFeedback?.blockReason) throw new Error(`Gemini API blocked prompt: ${response.promptFeedback.blockReason}`);
      // Video specific finish reason check
      if (response.candidates[0].finishReason !== 'STOP' && response.candidates[0].finishReason !== 'MAX_TOKENS') {
          console.warn(`Gemini API finished video analysis with reason: ${response.candidates[0].finishReason}. Output may be incomplete.`);
          // Only throw if *no* text is present, otherwise allow potentially partial output
          if (!response.candidates[0].content?.parts?.[0]?.text) {
                throw new Error(`Gemini API stopped (${response.candidates[0].finishReason}) and returned no text.`);
          }
      }
      if (!response.candidates[0].content?.parts?.[0]?.text) throw new Error('Gemini API returned no text content.');
      // Return the text
      const analysis = response.candidates[0].content.parts[0].text;
      console.log("--- Video Analysis Result ---"); console.log(analysis); console.log("---------------------------");
      return analysis;
    } catch (error) {
      console.error('Video Analysis API call error:', error);
      throw new Error(`Video Analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// --- Helper to read local image file ---
function readLocalImage(imagePath: string): { type: 'base64', data: string, mimeType: string } | null {
    const resolvedPath = path.resolve(imagePath);
    if (!fs.existsSync(resolvedPath)) { console.error(`   Local image not found: ${resolvedPath}`); return null; }
    try {
        const data = fs.readFileSync(resolvedPath);
        const base64 = data.toString('base64');
        const mimeType = mime.lookup(resolvedPath) || 'application/octet-stream';
        if (!mimeType.startsWith('image/')) { console.error(`   File not image: ${resolvedPath} (${mimeType})`); return null; }
        return { type: 'base64', data: base64, mimeType: mimeType };
    } catch (e) { console.error(`   Error reading image ${resolvedPath}:`, e); return null; }
}

// --- Helper to read local video file ---
function readLocalVideo(videoPath: string): { type: 'base64', data: string, mimeType: string } | null {
    const resolvedPath = path.resolve(videoPath);
    if (!fs.existsSync(resolvedPath)) { console.error(`   Local video not found: ${resolvedPath}`); return null; }
    try {
        // Basic size check before reading potentially huge file into memory
        const stats = fs.statSync(resolvedPath);
        const fileSizeMB = stats.size / (1024 * 1024);
        // Set a reasonable limit for reading local files to avoid memory issues,
        // slightly larger than the base64 limit because base64 encoding adds overhead.
        if (fileSizeMB > 25) { // Example: Don't read files > 25MB raw size
             console.warn(`   WARNING: Local video file ${resolvedPath} is large (~${fileSizeMB.toFixed(2)}MB > 25MB raw), skipping read.`);
             return null;
        }

        const data = fs.readFileSync(resolvedPath);
        const base64 = data.toString('base64');
        const detectedMimeType = mime.lookup(resolvedPath) || 'application/octet-stream';

        // --- MIME Type Mapping ---
        let finalMimeType = detectedMimeType;
         if (detectedMimeType === 'application/mp4') {
            finalMimeType = 'video/mp4';
            console.log(`   Mapping local MIME type application/mp4 -> video/mp4 for ${resolvedPath}`);
        } else if (detectedMimeType === 'video/quicktime') {
            finalMimeType = 'video/mov';
            console.log(`   Mapping local MIME type video/quicktime -> video/mov for ${resolvedPath}`);
        }
        // --- End MIME Type Mapping ---

        // Check mapped type against Gemini's supported list
        if (!supportedVideoMimeTypes.includes(finalMimeType)) {
            console.error(`   File not a supported video type (after mapping): ${resolvedPath} (Mapped: ${finalMimeType}, Detected: ${detectedMimeType})`);
            return null;
        }

        // Final size check on base64 happens in analyzeVideoWithGemini
        return { type: 'base64', data: base64, mimeType: finalMimeType }; // Return the potentially mapped type
    } catch (e) { console.error(`   Error reading video ${resolvedPath}:`, e); return null; }
}

// --- Main test execution ---
async function runTests() {
  console.log("Starting Gemini Native SDK Media Tests...");
  // Helper for delays between API calls
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const TEST_DELAY = 2000; // Delay in ms

  // --- Test Media Assets ---
  // Images
  const testImageUrl1 = 'https://storage.googleapis.com/generativeai-downloads/images/scones.jpg';
  const testImageUrl2 = 'https://storage.googleapis.com/generativeai-downloads/data/scene.jpg';
  const localImagePath1 = 'test-image.png'; // Ensure this exists
  const localImagePath2 = 'test-image2.jpg'; // Optional: Add a second test image

  // Videos
  const testVideoUrlSmall = 'https://storage.googleapis.com/generativeai-downloads/videos/Big_Buck_Bunny.mp4'; // Small downloadable video
  const testYoutubeUrl1 = 'https://www.youtube.com/watch?v=9hE5-98ZeCg'; // Google IO Keynote snippet
  const testYoutubeUrl2 = 'https://www.youtube.com/watch?v=zR_4h5A5z_A'; // Gemini launch video
  const localVideoPath1 = 'test-video.mp4'; // Ensure this is a SMALL (<20MB) mp4 file in project root
  const localVideoPath2 = 'test-video2.mov'; // Optional: Add a second small video (e.g., .mov)

  // Read local files
  console.log("Reading local test files...");
  const localImage1 = readLocalImage(localImagePath1);
  const localImage2 = readLocalImage(localImagePath2);
  const localVideo1 = readLocalVideo(localVideoPath1);
  const localVideo2 = readLocalVideo(localVideoPath2);
  console.log("Finished reading local files.");


  // --- Image Test Cases ---
  console.log("\n--- Running Image Tests --- ");
  // Test I1: Single Image URL
   console.log("\n--- Test I1: Single Image URL ---");
  try { await analyzeImageWithGemini([{ type: 'url', data: testImageUrl1 }]); } catch (e) { console.error("Test I1 Failed:", e); }
  await delay(TEST_DELAY);
  // Test I2: Single Local Image File
  console.log("\n--- Test I2: Single Local Image ---");
  if (localImage1) { try { await analyzeImageWithGemini([localImage1]); } catch (e) { console.error("Test I2 Failed:", e); } } else { console.log(`Skipping Test I2 (image not found: ${localImagePath1}).`); }
  await delay(TEST_DELAY);
  // Test I3: Multiple Image URLs
  console.log("\n--- Test I3: Multiple Image URLs ---");
  try { await analyzeImageWithGemini([{ type: 'url', data: testImageUrl1 }, { type: 'url', data: testImageUrl2 }], "Compare these two images."); } catch (e) { console.error("Test I3 Failed:", e); }
  await delay(TEST_DELAY); 
  // Test I4: Multiple Local Images
   console.log("\n--- Test I4: Multiple Local Images ---");
 const localImagesTest4 = [localImage1, localImage2].filter(Boolean) as Array<{ type: 'base64', data: string, mimeType: string }>;
  if (localImagesTest4.length >= 2) { try { await analyzeImageWithGemini(localImagesTest4, "Describe both images."); } catch (e) { console.error("Test I4 Failed:", e); } } else { console.log(`Skipping Test I4 (need 2 local images: ${localImagePath1}, ${localImagePath2}. Found ${localImagesTest4.length}).`); }
  await delay(TEST_DELAY);
  // Test I5: Mix of Image URL and Local File
  console.log("\n--- Test I5: Mix Image URL/Local ---");
  if (localImage1) { try { await analyzeImageWithGemini([{ type: 'url', data: testImageUrl2 }, localImage1], "What is in each image?"); } catch (e) { console.error("Test I5 Failed:", e); } } else { console.log(`Skipping Test I5 (image not found: ${localImagePath1}).`); }


  // --- Video Test Cases ---
  console.log("\n\n--- Running Video Tests --- ");
  // Test V1: Single YouTube URL
  console.log("\n--- Test V1: Single YouTube URL ---");
  try { await analyzeVideoWithGemini([{ type: 'youtube', data: testYoutubeUrl1 }], "Summarize this short video."); } catch (e) { console.error("Test V1 Failed:", e); }
  await delay(TEST_DELAY * 1.5); // Slightly longer delay for video */
  // Test V2: Single Video URL (Download)
 console.log("\n--- Test V2: Single Video URL (Download) ---");
  try { await analyzeVideoWithGemini([{ type: 'url', data: testVideoUrlSmall }], "What activity is shown?"); } catch (e) { console.error("Test V2 Failed:", e); }
  await delay(TEST_DELAY * 1.5); 
  // Test V3: Single Local Video File
  console.log("\n--- Test V3: Single Local Video ---");
  if (localVideo1) { try { await analyzeVideoWithGemini([localVideo1], "Describe the main action."); } catch (e) { console.error("Test V3 Failed:", e); } } else { console.log(`Skipping Test V3 (video not found/readable: ${localVideoPath1}).`); }
  await delay(TEST_DELAY * 1.5);
  
  // Test V5: Multiple Local Videos
  console.log("\n--- Test V5: Multiple Local Videos ---");
  const localVideosTest5 = [localVideo1, localVideo2].filter(Boolean) as Array<{ type: 'base64', data: string, mimeType: string }>;
  if (localVideosTest5.length >= 2) { try { await analyzeVideoWithGemini(localVideosTest5, "Describe the content of these videos."); } catch (e) { console.error("Test V5 Failed:", e); } } else { console.log(`Skipping Test V5 (need 2 local videos: ${localVideoPath1}, ${localVideoPath2}. Found ${localVideosTest5.length}).`); }
  await delay(TEST_DELAY * 1.5);
  // Test V6: Mix of YouTube and Local Video
  console.log("\n--- Test V6: Mix YouTube/Local Video ---");
  if (localVideo1) { try { await analyzeVideoWithGemini([{ type: 'youtube', data: testYoutubeUrl1 }, localVideo1], "Summarize both videos."); } catch (e) { console.error("Test V6 Failed:", e); } } else { console.log(`Skipping Test V6 (video not found/readable: ${localVideoPath1}).`); }


   console.log("\nGemini Native SDK Media tests finished.");
}

runTests();
