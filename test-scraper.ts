import { resolveRedirectPuppeteer, scrapeProductPuppeteer, fetchShopeeOfficialApi } from './src/services/scraper';
import { generateOfferTexts } from './src/services/openai';
import dotenv from 'dotenv';
dotenv.config();

const linkUrl = 'https://s.shopee.com.br/Ll7WSF1Vd';

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

async function runTest() {
  console.log(`[TEST] Resolvendo redirecionamento para: ${linkUrl}`);
  
  let finalUrl = await resolveRedirectPuppeteer(linkUrl);
  console.log(`[TEST] URL Final: ${finalUrl}`);
  
  let keyword = extractKeywordFromUrl(finalUrl);
  
  let productTitle = keyword || 'Oferta Especial';
  let productPrice = '';
  let productImageUrl = '';

  const itemId = extractItemIdFromUrl(finalUrl);
  if (itemId) {
    console.log(`[TEST] Consultando API Oficial diretamente (ItemID: ${itemId})...`);
    const officialData = await fetchShopeeOfficialApi(itemId);
    if (officialData) {
      productTitle = officialData.title || productTitle;
      productPrice = officialData.price || productPrice;
      productImageUrl = officialData.imageUrl || productImageUrl;
    }
  }

  if (!productPrice && keyword) {
    console.log(`[TEST] Consultando API Oficial por keyword: ${keyword}`);
    const officialData = await fetchShopeeOfficialApi(keyword);
    if (officialData) {
      productTitle = officialData.title || productTitle;
      productPrice = officialData.price || productPrice;
      productImageUrl = officialData.imageUrl || productImageUrl;
    }
  }

  if (!productPrice) {
    console.log(`[TEST] Iniciando Scraper Puppeteer como Fallback...`);
    const scrapedData = await scrapeProductPuppeteer(finalUrl);
    if (scrapedData) {
      productTitle = scrapedData.title || productTitle;
      productPrice = scrapedData.price || productPrice;
      productImageUrl = scrapedData.imageUrl || productImageUrl;
    }
  }

  console.log('--- DADOS EXTRAÍDOS ---');
  console.log('Título:', productTitle);
  console.log('Preço:', productPrice);
  console.log('Imagem:', productImageUrl);
  console.log('-----------------------');

  if (productTitle && productPrice) {
    console.log(`[TEST] Gerando textos via OpenAI...`);
    const generated = await generateOfferTexts({
      productName: productTitle,
      currentPrice: productPrice,
      platform: 'shopee',
      affiliateLink: linkUrl
    });

    console.log('\n--- RESULTADO OPENAI ---');
    console.log(JSON.stringify(generated, null, 2));
    console.log('------------------------');
  } else {
    console.log('[TEST] Falha ao extrair título ou preço. A geração da OpenAI não foi acionada.');
  }

  process.exit(0);
}

runTest().catch(console.error);
