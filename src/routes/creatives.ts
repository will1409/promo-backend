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

// POST /api/creatives/generate-from-link
router.post('/generate-from-link', async (req: Request, res: Response) => {
  try {
    const { linkUrl, userId } = req.body;
    if (!linkUrl) {
      return res.status(400).json({ error: 'URL é obrigatória.' });
    }

    let finalUrl = linkUrl;
    let keyword = extractKeywordFromUrl(finalUrl);

    // 1. Resolução do Redirecionamento via Playwright (Bypass de links curtos)
    if (!keyword && (linkUrl.includes('s.shopee') || linkUrl.includes('shope.ee') || linkUrl.includes('shp.ee'))) {
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

    // --- CAMADA 2: API OFICIAL DA SHOPEE ---
    if (keyword) {
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

    // Se falhou em tudo, retorna erro
    if (!productPrice && !productImageUrl) {
      return res.status(400).json({ 
        error: 'Link protegido pela Shopee. Por favor, cole o nome do produto no link ou digite o valor e suba a foto manualmente.' 
      });
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
