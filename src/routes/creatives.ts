import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../config/firebase';
import { resolveRedirectPuppeteer, fetchShopeeOfficialApi, scrapeProductPuppeteer, fetchMercadoLivreApi, scrapeAmazonHttp, scrapeMercadoLivreHttp, fetchAmazonOfficialApi } from '../services/scraper';
import { getUserLimits } from '../utils/planLimits';

const router = Router();

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

// POST /api/creatives/generate-from-link
router.post('/generate-from-link', async (req: Request, res: Response) => {
  try {
    const { linkUrl, userId } = req.body;
    if (!linkUrl) {
      return res.status(400).json({ error: 'URL é obrigatória.' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const limits = await getUserLimits(userId);
    if (limits.dailyOffers === 0) {
      return res.status(403).json({ error: 'Seu plano atual não permite utilizar esta ferramenta. Faça upgrade.' });
    }

    let finalUrl = linkUrl;
    let keyword = extractKeywordFromUrl(finalUrl);

    // 1. Resolução do Redirecionamento (Bypass de links curtos) - Qualquer plataforma (Shopee, Amazon, Mercado Livre, etc.)
    if (linkUrl && linkUrl.startsWith('http')) {
      finalUrl = await resolveRedirectPuppeteer(linkUrl);
      keyword = extractKeywordFromUrl(finalUrl);
    }
    
    // Fallback: Se for só texto ou busca, a keyword é o próprio texto.
    if (!keyword && !finalUrl.startsWith('http')) {
      keyword = finalUrl;
    }

    // Cache removido para economizar cota do Firestore

    let shopeeAppId: string | undefined;
    let shopeeAppSecret: string | undefined;
    let mercadoLivreAppId: string | undefined;
    let mercadoLivreClientSecret: string | undefined;
    let amazonAccessKey: string | undefined;
    let amazonSecretKey: string | undefined;
    let amazonPartnerTag: string | undefined;

    try {
      if (userId) {
        const integrationsDoc = await db.collection('users').doc(userId).collection('settings').doc('integrations').get();
        if (integrationsDoc.exists) {
          const integrations = integrationsDoc.data();
          shopeeAppId = integrations?.shopeeAppId;
          shopeeAppSecret = integrations?.shopeeAppSecret;
          mercadoLivreAppId = integrations?.mercadoLivreAppId;
          mercadoLivreClientSecret = integrations?.mercadoLivreClientSecret;
          amazonAccessKey = integrations?.amazonAccessKey;
          amazonSecretKey = integrations?.amazonSecretKey;
          amazonPartnerTag = integrations?.amazonPartnerTag;
        }
      }
    } catch (err) {
      console.error('[creatives] Erro ao buscar integrações do usuário:', err);
    }

    let productTitle = keyword || 'Oferta Especial';
    let productPrice = '';
    let productImageUrl = '';

    // --- CAMADA 1.5: CONSULTA DIRETA POR ITEM ID NA API OFICIAL (Bypassa Playwright se funcionar) ---
    const itemId = extractItemIdFromUrl(finalUrl);
    if (itemId && (finalUrl.includes('shopee') || linkUrl.includes('shopee'))) {
      console.log(`[creatives] Item ID detectado: ${itemId}. Consultando API Oficial diretamente...`);
      const officialData = await fetchShopeeOfficialApi(itemId, shopeeAppId, shopeeAppSecret);
      if (officialData) {
        productTitle = officialData.title || productTitle;
        productPrice = officialData.price || productPrice;
        productImageUrl = officialData.imageUrl || productImageUrl;
        console.log(`[creatives] Sucesso na consulta direta por Item ID! Preço: ${productPrice}`);
      }
    }

    // --- CAMADA 2: API OFICIAL DA SHOPEE (Por Keyword da URL se a por ID falhar) ---
    if (!productPrice && keyword) {
      const officialData = await fetchShopeeOfficialApi(keyword, shopeeAppId, shopeeAppSecret);
      if (officialData) {
        productTitle = officialData.title || productTitle;
        productPrice = officialData.price || productPrice;
        productImageUrl = officialData.imageUrl || productImageUrl;
      }
    }

    // --- CAMADA 2.5: API OFICIAL DA AMAZON ---
    if (!productPrice && (finalUrl.includes('amazon') || linkUrl.includes('amazon') || linkUrl.includes('amzn'))) {
      const amzOfficialData = await fetchAmazonOfficialApi(keyword, amazonAccessKey, amazonSecretKey, amazonPartnerTag);
      if (amzOfficialData) {
        productTitle = amzOfficialData.title || productTitle;
        productPrice = amzOfficialData.price || productPrice;
        productImageUrl = amzOfficialData.imageUrl || productImageUrl;
      }
    }

    // --- CAMADA 3: API PÚBLICA DO MERCADO LIVRE E CHEERIO AMAZON ---
    if (!productPrice && (finalUrl.includes('mercadolivre') || linkUrl.includes('mercadolivre') || linkUrl.includes('meli'))) {
      const mlData = await fetchMercadoLivreApi(finalUrl, mercadoLivreAppId, mercadoLivreClientSecret);
      if (mlData) {
        productTitle = mlData.title || productTitle;
        productPrice = mlData.price || productPrice;
        productImageUrl = mlData.imageUrl || productImageUrl;
      }
    }

    if (!productPrice && (finalUrl.includes('amazon') || linkUrl.includes('amazon') || linkUrl.includes('amzn'))) {
      const amzData = await scrapeAmazonHttp(finalUrl);
      if (amzData) {
        productTitle = amzData.title || productTitle;
        productPrice = amzData.price || productPrice;
        productImageUrl = amzData.imageUrl || productImageUrl;
      }
    }

    if (!productPrice && (finalUrl.includes('mercadolivre') || linkUrl.includes('mercadolivre') || linkUrl.includes('meli.la'))) {
      const mlHttpData = await scrapeMercadoLivreHttp(finalUrl);
      if (mlHttpData) {
        productTitle = mlHttpData.title || productTitle;
        productPrice = mlHttpData.price || productPrice;
        productImageUrl = mlHttpData.imageUrl || productImageUrl;
      }
    }

    // --- CAMADA 3: PLAYWRIGHT FALLBACK ---
    if (!productPrice || !productImageUrl) {
      const scrapedData = await scrapeProductPuppeteer(finalUrl);
      if (scrapedData) {
        productTitle = scrapedData.title || productTitle;
        productPrice = scrapedData.price || productPrice;
        productImageUrl = scrapedData.imageUrl || productImageUrl;
      }
    }

    // --- CAMADA 3.5: API OFICIAL FALLBACK COM O TÍTULO RASPADO (Somente Shopee) ---
    if (!productPrice && productTitle && productTitle !== 'Oferta Especial' && (finalUrl.includes('shopee') || linkUrl.includes('shopee'))) {
      console.log(`[creatives] Tentando API Oficial com título raspado: "${productTitle}"`);
      const officialData = await fetchShopeeOfficialApi(productTitle);
      if (officialData) {
        productTitle = officialData.title || productTitle;
        productPrice = officialData.price || productPrice;
        productImageUrl = officialData.imageUrl || productImageUrl;
        console.log(`[creatives] Sucesso via API Oficial usando título raspado! Preço: ${productPrice}`);
      }
    }

    // Se não encontrou preço/imagem, continua mesmo assim com o que temos
    // O frontend vai mostrar os campos em branco para o usuário preencher manualmente
    if (!productPrice && !productImageUrl) {
      console.log('[creatives] Não foi possível extrair preço/imagem. Retornando dados parciais.');
    }

    // Salvamento no cache removido

    // Retorno de sucesso (direto pra tela)
    return res.json({ 
      success: true, 
      data: { 
        productName: productTitle, 
        description: "Oferta Especial Shopee!", 
        price: productPrice, 
        oldPrice: "", 
        imageUrl: productImageUrl,
        finalUrl: finalUrl
      } 
    });
  } catch (error: any) {
    console.error('[/api/creatives/generate-from-link]', error);
    return res.status(500).json({ error: `Erro ao gerar dados do criativo: ${error.message || String(error)}` });
  }
});

router.get('/test-scraper', async (req: Request, res: Response) => {
  let browser;
  try {
    const { chromium } = require('playwright-extra');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
    });
    const version = browser.version();
    await browser.close();
    return res.json({ success: true, message: `Playwright Chromium launched successfully! Version: ${version}` });
  } catch (err: any) {
    return res.json({ 
      success: false, 
      error: err.message || String(err), 
      stack: err.stack || '' 
    });
  }
});

export default router;
