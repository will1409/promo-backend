import { resolveRedirectPuppeteer, scrapeProductPuppeteer, fetchShopeeOfficialApi } from './src/services/scraper';

async function test() {
  const link = 'https://s.shopee.com.br/3g1cSwIx60';
  console.log('Testing link:', link);
  const finalUrl = await resolveRedirectPuppeteer(link);
  console.log('Final URL:', finalUrl);
  
  if (finalUrl === link) {
    console.log('Failed to resolve redirect. Trying scrapeProductPuppeteer...');
    const data = await scrapeProductPuppeteer(link);
    console.log('Scraped data:', data);
  } else {
    console.log('Resolved! Now we can extract info.');
  }
}

test().catch(console.error);
