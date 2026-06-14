import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateCreativeFlow } from '../genkit';

const router = Router();

// POST /api/creatives/generate-from-link
router.post('/generate-from-link', async (req: Request, res: Response) => {
  try {
    const { linkUrl } = req.body;
    if (!linkUrl) {
      return res.status(400).json({ error: 'linkUrl é obrigatório.' });
    }

    const generated = await generateCreativeFlow({ linkUrl });
    return res.json({ success: true, data: generated });
  } catch (error: any) {
    console.error('[/api/creatives/generate-from-link]', error.message);
    return res.status(500).json({ error: 'Erro ao gerar dados do criativo.' });
  }
});

export default router;
