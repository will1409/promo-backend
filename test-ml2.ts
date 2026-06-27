import { scrapeProductPuppeteer } from './src/services/scraper';

async function test() {
  console.log('Testing ML social link...');
  const res = await scrapeProductPuppeteer('https://meli.la/2jaCAsd');
  console.log('Result:', res);
  process.exit(0);
}

test();
