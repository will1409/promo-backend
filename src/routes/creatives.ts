import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateCreativeFlow } from '../genkit';
import https from 'https';

const router = Router();

async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) return undefined;
    const html = await response.text();
    // Try to find og:image
    const ogMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["'](.*?)["']/i) || 
                    html.match(/<meta\s+content=["'](.*?)["']\s+(?:property|name)=["']og:image["']/i);
    if (ogMatch && ogMatch[1]) {
      return ogMatch[1];
    }
    // Try to find Amazon landing image
    const amzMatch = html.match(/id="landingImage"[^>]*src=["'](.*?)["']/i);
    if (amzMatch && amzMatch[1]) {
      return amzMatch[1];
    }
    return undefined;
  } catch (error) {
    console.error('Fetch image error:', error);
    return undefined;
  }
}

// POST /api/creatives/generate-from-link
router.post('/generate-from-link', async (req: Request, res: Response) => {
  try {
    const { linkUrl } = req.body;
    if (!linkUrl) {
      return res.status(400).json({ error: 'linkUrl é obrigatório.' });
    }

    const generated = await generateCreativeFlow({ linkUrl });
    const imageUrl = await fetchOgImage(linkUrl);
    
    return res.json({ success: true, data: { ...generated, imageUrl } });
  } catch (error: any) {
    console.error('[/api/creatives/generate-from-link]', error.message);
    return res.status(500).json({ error: 'Erro ao gerar dados do criativo.' });
  }
});

export default router;
