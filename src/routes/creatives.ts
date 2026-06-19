import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateCreativeFlow } from '../genkit';
import { db } from '../config/firebase';
import { resolveRedirectPuppeteer, fetchShopeeOfficialApi, scrapeProductPuppeteer } from '../services/scraper';

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

    // --- CAMADA 1: CACHE NO FIREBASE ---
    const cacheKey = keyword ? keyword.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100) : null;
    if (cacheKey) {
      try {
        const cacheDoc = await db.collection('productsCache').doc(cacheKey).get();
        if (cacheDoc.exists) {
          const cachedData = cacheDoc.data();
          // Verifica se o cache é de hoje (menos de 24h)
          const cacheAgeHours = (Date.now() - (cachedData?.timestamp || 0)) / (1000 * 60 * 60);
          if (cacheAgeHours < 24) {
            console.log('📦 Retornado do Cache do Firebase:', cacheKey);
            return res.json({ 
              success: true, 
              data: { 
                productName: cachedData?.productName, 
                description: "Oferta Especial Shopee!", 
                price: cachedData?.price, 
                oldPrice: "", 
                imageUrl: cachedData?.imageUrl,
                finalUrl: finalUrl
              } 
            });
          }
        }
      } catch (err) {
        console.error('Erro ao ler cache do Firebase:', err);
      }
    }

    let productTitle = keyword || 'Oferta Especial';
    let productPrice = '';
    let productImageUrl = '';

    // --- CAMADA 1.5: CONSULTA DIRETA POR ITEM ID NA API OFICIAL (Bypassa Playwright se funcionar) ---
    const itemId = extractItemIdFromUrl(finalUrl);
    if (itemId && (finalUrl.includes('shopee') || linkUrl.includes('shopee'))) {
      console.log(`[creatives] Item ID detectado: ${itemId}. Consultando API Oficial diretamente...`);
      const officialData = await fetchShopeeOfficialApi(itemId);
      if (officialData) {
        productTitle = officialData.title || productTitle;
        productPrice = officialData.price || productPrice;
        productImageUrl = officialData.imageUrl || productImageUrl;
        console.log(`[creatives] Sucesso na consulta direta por Item ID! Preço: ${productPrice}`);
      }
    }

    // --- CAMADA 2: API OFICIAL DA SHOPEE (Por Keyword da URL se a por ID falhar) ---
    if (!productPrice && keyword) {
      const officialData = await fetchShopeeOfficialApi(keyword);
      if (officialData) {
        productTitle = officialData.title || productTitle;
        productPrice = officialData.price || productPrice;
        productImageUrl = officialData.imageUrl || productImageUrl;
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

    // --- CAMADA 4: SALVAR NO CACHE ---
    if (cacheKey && productPrice && productImageUrl) {
      try {
        await db.collection('productsCache').doc(cacheKey).set({
          productName: productTitle,
          price: productPrice,
          imageUrl: productImageUrl,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('Erro ao salvar no cache do Firebase:', err);
      }
    }

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

export default router;
