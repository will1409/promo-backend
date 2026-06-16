import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateCreativeFlow } from '../genkit';
import { db } from '../config/firebase';

const router = Router();

export async function fetchPageData(url: string, integrations: any = {}) {
  try {
    // 1. Resolve redirect manually to get the final URL (solves amzn.to, shope.ee)
    let finalUrl = url;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(finalUrl, { 
          redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (loc) {
            finalUrl = loc.startsWith('http') ? loc : new URL(loc, finalUrl).toString();
          } else break;
        } else break;
      } catch (e) { break; }
    }

    // 2. Fetch HTML from final URL (Use ScraperAPI if available)
    let fetchUrl = finalUrl;
    let fetchHeaders: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    };

    if (integrations.scraperApiKey) {
      // Usa o proxy do ScraperAPI para burlar o bloqueio!
      fetchUrl = `http://api.scraperapi.com?api_key=${integrations.scraperApiKey}&url=${encodeURIComponent(finalUrl)}`;
      // Quando usamos scraper, headers customizados não são necessários
      fetchHeaders = undefined;
    }

    const response = await fetch(fetchUrl, { headers: fetchHeaders });
    
    if (!response.ok) return { imageUrl: undefined, pageTitle: undefined, htmlContent: undefined, finalUrl };
    
    const html = await response.text();
    
    // Extract Image
    let imageUrl;
    const ogMatch = html.match(/<meta[^>]*?(?:property|name)=["']og:image["'][^>]*?content=["'](.*?)["']/i) || 
                    html.match(/<meta[^>]*?content=["'](.*?)["'][^>]*?(?:property|name)=["']og:image["']/i);
    if (ogMatch && ogMatch[1]) imageUrl = ogMatch[1];
    else {
      const amzMatch = html.match(/id="landingImage"[^>]*src=["'](.*?)["']/i);
      if (amzMatch && amzMatch[1]) imageUrl = amzMatch[1];
    }

    // Extract Title
    let pageTitle;
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) pageTitle = titleMatch[1];

    // Get a chunk of HTML (first 15000 chars) to pass to Gemini
    const htmlContent = html.substring(0, 15000);

    return { imageUrl, pageTitle, htmlContent, finalUrl };
  } catch (error) {
    console.error('Fetch page error:', error);
    return { imageUrl: undefined, pageTitle: undefined, htmlContent: undefined, finalUrl: url };
  }
}

// POST /api/creatives/generate-from-link
router.post('/generate-from-link', async (req: Request, res: Response) => {
  try {
    const { linkUrl, userId } = req.body;
    if (!linkUrl) {
      return res.status(400).json({ error: 'linkUrl é obrigatório.' });
    }

    // Carregar integrações do usuário
    let integrations: any = {};
    if (userId) {
      try {
        const docSnap = await db.doc(`users/${userId}/settings/integrations`).get();
        if (docSnap.exists) {
          integrations = docSnap.data() || {};
        }
      } catch (err) {
        console.error('Erro ao buscar integracoes:', err);
      }
    }

    const hasShopee = !!(integrations.shopeeAppId && integrations.shopeeAppSecret);
    const hasMeli = !!(integrations.mercadoLivreAppId && integrations.mercadoLivreClientSecret);
    const hasAmazon = !!(integrations.amazonAccessKey && integrations.amazonSecretKey);
    const hasScraper = !!integrations.scraperApiKey;

    if (!hasScraper && !hasShopee && !hasMeli && !hasAmazon) {
      return res.status(403).json({ error: 'Você precisa conectar alguma API na aba "Integrações" para usar a inteligência artificial com links originais.' });
    }

    const { imageUrl, pageTitle, htmlContent, finalUrl } = await fetchPageData(linkUrl, integrations);
    
    const generated = await generateCreativeFlow({ linkUrl, finalUrl, pageTitle, htmlContent });
    
    return res.json({ success: true, data: { ...generated, imageUrl } });
  } catch (error: any) {
    console.error('[/api/creatives/generate-from-link]', error.message);
    return res.status(500).json({ error: 'Erro ao gerar dados do criativo.' });
  }
});

export default router;
