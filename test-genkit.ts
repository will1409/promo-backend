import { genkit } from 'genkit';
import { googleAI, gemini15Flash, gemini15Pro, gemini15Flash8b } from '@genkit-ai/googleai';

// need dotenv for GOOGLE_GENAI_API_KEY
require('dotenv').config();

const ai = genkit({
  plugins: [googleAI()],
});

async function run() {
  console.log("Testing gemini15Pro...");
  try {
    const res = await ai.generate({ model: gemini15Pro, prompt: "Hello" });
    console.log("Success:", res.text);
  } catch(e: any) {
    console.error("gemini15Pro failed:", e.message);
  }

  // testing direct string
  console.log("Testing string 'googleai/gemini-2.5-flash'...");
  try {
    const res = await ai.generate({ model: 'googleai/gemini-2.5-flash', prompt: "Hello" });
    console.log("Success:", res.text);
  } catch(e: any) {
    console.error("string 2.5 flash failed:", e.message);
  }
}

run();
