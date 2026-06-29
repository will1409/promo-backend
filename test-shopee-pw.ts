import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

async function testPlaywright() {
  const shortLink = 'https://s.shopee.com.br/3g1cSwIx60';
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    console.log('Navigating with Playwright...');
    await page.goto(shortLink, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const finalUrl = page.url();
    console.log('Playwright resolved URL:', finalUrl);
  } catch (err) {
    console.error("Playwright failed:", err);
  } finally {
    if (browser) await browser.close();
  }
}

testPlaywright().catch(console.error);
