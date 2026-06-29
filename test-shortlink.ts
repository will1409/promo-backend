import { resolveRedirectPuppeteer, fetchShopeeOfficialApi, scrapeProductPuppeteer } from './src/services/scraper';
function extractKeywordFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('shopee')) {
      const pathParts = urlObj.pathname.split('/');
      const slug = pathParts.find(p => p.includes('-i.'));
      if (slug) {
        return decodeURIComponent(slug.split('-i.')[0].replace(/-/g, ' '));
      }
    }
  } catch (e) {}
  return "";
}

function extractItemIdFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('shopee')) {
      const matchDesktop = urlObj.pathname.match(/-i\.\d+\.(\d+)/);
      if (matchDesktop && matchDesktop[1]) {
        return matchDesktop[1];
      }
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        const lastPart = pathParts[pathParts.length - 1];
        if (/^\d+$/.test(lastPart)) {
          return lastPart;
        }
      }
    }
  } catch (e) {}
  return "";
}

async function testLink(linkUrl: string) {
  console.log(`\nTesting link: ${linkUrl}`);
  let finalUrl = linkUrl;
  let keyword = extractKeywordFromUrl(finalUrl);

  console.log("Resolving redirect...");
  finalUrl = await resolveRedirectPuppeteer(linkUrl);
  console.log("Resolved to:", finalUrl);
  
  keyword = extractKeywordFromUrl(finalUrl);
  console.log("Extracted keyword:", keyword);

  let productTitle = keyword || 'Oferta Especial';
  let productPrice = '';
  let productImageUrl = '';

  const itemId = extractItemIdFromUrl(finalUrl);
  if (itemId) {
    console.log('Querying Official API with itemId:', itemId);
    const officialData = await fetchShopeeOfficialApi(itemId);
    if (officialData) {
      productTitle = officialData.title || productTitle;
      productPrice = officialData.price || productPrice;
      productImageUrl = officialData.imageUrl || productImageUrl;
    }
  }

  if (!productPrice && keyword) {
    console.log('Querying Official API with keyword:', keyword);
    const officialData = await fetchShopeeOfficialApi(keyword);
    if (officialData) {
      productTitle = officialData.title || productTitle;
      productPrice = officialData.price || productPrice;
      productImageUrl = officialData.imageUrl || productImageUrl;
    }
  }

  if (!productPrice || !productImageUrl) {
    console.log('Fallback to Puppeteer...');
    const scrapedData = await scrapeProductPuppeteer(finalUrl);
    if (scrapedData) {
      productTitle = scrapedData.title || productTitle;
      productPrice = scrapedData.price || productPrice;
      productImageUrl = scrapedData.imageUrl || productImageUrl;
    }
  }

  console.log('Result:', { productTitle, productPrice, productImageUrl });
}

async function run() {
  await testLink('https://s.shopee.com.br/3B5O3r9C7E');
  process.exit(0);
}

run().catch(console.error);
