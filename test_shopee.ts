import { resolveShopeeShortlink } from './src/services/shopeeResolver';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        console.log('Testing Telegram bridge...');
        const shopeeData = await resolveShopeeShortlink('https://shope.ee/testlink123');
        console.log('Shopee Data:', shopeeData);
    } catch(e) {
        console.error('Error:', e);
    }
}

test();
