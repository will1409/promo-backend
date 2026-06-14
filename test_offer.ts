import { generateOfferFlow } from './src/genkit';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        const reply = await generateOfferFlow({
            productName: "iPhone 15",
            currentPrice: "5000",
        });
        console.log("OFFER REPLY:", reply);
    } catch(e) {
        console.error("OFFER ERROR:", e);
    }
}

test();
