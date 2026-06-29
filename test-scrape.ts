import { scrapeProductPuppeteer } from './src/services/scraper';

async function test() {
  const link = 'https://s.shopee.com.br/3g1cSwIx60';
  console.log('Testing scrapeProductPuppeteer with short link:', link);
  const data = await scrapeProductPuppeteer(link);
  console.log('Scraped data:', data);
}

test().catch(console.error);
