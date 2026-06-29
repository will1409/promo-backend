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
      // 1. Tenta padrão de slug desktop: -i.shopId.itemId
      const matchDesktop = urlObj.pathname.match(/-i\.\d+\.(\d+)/);
      if (matchDesktop && matchDesktop[1]) {
        return matchDesktop[1];
      }
      // 2. Tenta padrão de caminho mobile: /shopName/shopId/itemId
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

async function testGenerator() {
  const linkUrl = 'https://s.shopee.com.br/3g1cSwIx60';
  let finalUrl = linkUrl;
  let keyword = extractKeywordFromUrl(finalUrl);

  if (linkUrl && linkUrl.startsWith('http')) {
    finalUrl = await resolveRedirectPuppeteer(linkUrl);
    keyword = extractKeywordFromUrl(finalUrl);
  }

  if (!keyword && !finalUrl.startsWith('http')) {
    keyword = finalUrl;
  }

  let productTitle = keyword || 'Oferta Especial';
  let productPrice = '';
  let productImageUrl = '';

  const itemId = extractItemIdFromUrl(finalUrl);
  if (itemId && (finalUrl.includes('shopee') || linkUrl.includes('shopee'))) {
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

  console.log('--- Final Result ---');
  console.log({
    finalUrl,
    pageTitle: productTitle,
    imageUrl: productImageUrl,
    price: productPrice
  });
}

testGenerator().catch(console.error);
