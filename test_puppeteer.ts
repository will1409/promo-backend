import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function testShopee() {
  const browser = await puppeteer.launch({ headless: false }); // Headless false helps bypass sometimes, or use 'new'
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://shopee.com.br/Kit-AMD-Ryzen-7-5700X-e-Placa-M%C3%A3e-B550M-Aorus-Elite-Bios-Atualizada-i.380962383.15170327310', { waitUntil: 'networkidle2' });
  
  // Wait for price selector
  try {
    await page.waitForSelector('.pqTWkA, .Yn2Efq, ._045z9, .a-price', { timeout: 10000 });
    const content = await page.content();
    console.log("Success! Page loaded.");
    // Try to get title
    const title = await page.title();
    console.log("Title:", title);
  } catch (e) {
    console.log("Failed to load or find price.");
  }
  
  await browser.close();
}

testShopee();
