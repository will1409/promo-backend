import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateCreativeFlow } from '../genkit';
import https from 'https';

const router = Router();

async function fetchPageData(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });
    if (!response.ok) return { imageUrl: undefined, pageTitle: undefined, htmlContent: undefined };
    const html = await response.text();
    
    // Extract Image
    let imageUrl;
    const ogMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["'](.*?)["']/i) || 
                    html.match(/<meta\s+content=["'](.*?)["']\s+(?:property|name)=["']og:image["']/i);
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

    return { imageUrl, pageTitle, htmlContent };
  } catch (error) {
    console.error('Fetch page error:', error);
    return { imageUrl: undefined, pageTitle: undefined, htmlContent: undefined };
  }
}

// POST /api/creatives/generate-from-link
router.post('/generate-from-link', async (req: Request, res: Response) => {
  try {
    const { linkUrl } = req.body;
    if (!linkUrl) {
      return res.status(400).json({ error: 'linkUrl é obrigatório.' });
    }

    const { imageUrl, pageTitle, htmlContent } = await fetchPageData(linkUrl);
    
    const generated = await generateCreativeFlow({ linkUrl, pageTitle, htmlContent });
    
    return res.json({ success: true, data: { ...generated, imageUrl } });
  } catch (error: any) {
    console.error('[/api/creatives/generate-from-link]', error.message);
    return res.status(500).json({ error: 'Erro ao gerar dados do criativo.' });
  }
});

export default router;
