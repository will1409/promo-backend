import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';

process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, '../ms-playwright');
chromium.use(stealth());

async function test() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const link = 'https://s.shopee.com.br/3g1cSwIx60';
  console.log("Navigating to:", link);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  console.log("Playwright resolved URL:", page.url());
  
  await browser.close();
}

test().catch(console.error);
