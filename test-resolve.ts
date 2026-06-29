import { resolveRedirectPuppeteer } from './src/services/scraper';

async function test() {
  const link = 'https://s.shopee.com.br/3g1cSwIx60';
  const url = await resolveRedirectPuppeteer(link);
  console.log("Resolved URL:", url);
}

test().catch(console.error);
