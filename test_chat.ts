import { chatFlow } from './src/genkit';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        const reply = await chatFlow([{
            role: 'user',
            content: [{ text: 'ola' }]
        }]);
        console.log("REPLY:", reply);
    } catch(e) {
        console.error("ERROR:", e);
    }
}

test();
