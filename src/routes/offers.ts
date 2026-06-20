import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateOfferFlow } from '../genkit';
import { db } from '../config/firebase';

const router = Router();

// POST /api/offers/generate — Gera textos com Genkit Gemini
router.post('/generate', async (req: Request, res: Response) => {
  try {
    let { productName, currentPrice, oldPrice, category, platform, affiliateLink, userId } = req.body;

    if (!productName || productName.trim() === '') productName = 'Oferta Especial';
    if (!currentPrice || currentPrice.toString().trim() === '') currentPrice = 'Confira no site';

    const input = { productName, currentPrice, oldPrice, category, platform, affiliateLink, userId };

    // Chama o fluxo do Genkit (ele já salva no banco de dados se tiver userId)
    const generated = await generateOfferFlow(input);

    return res.json({ success: true, data: generated });
  } catch (error: any) {
    console.error('[/api/offers/generate]', error.message);
    return res.status(500).json({ error: 'Erro interno ao gerar oferta.', details: error.message });
  }
});


// GET /api/offers/:userId — Lista ofertas do usuário
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const snapshot = await db.collection('offers').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(50).get();
    const offers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, data: offers });
  } catch (error: any) {
    console.error('[/api/offers/:userId]', error.message);
    return res.status(500).json({ error: 'Erro ao buscar ofertas.' });
  }
});

// POST /api/offers/schedule — Agendar oferta
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const { userId, messageText, targetChannels, scheduledFor, imageUrl } = req.body;
    if (!userId || !messageText || !targetChannels || !scheduledFor) {
      return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    }

    const docRef = await db.collection('scheduled_offers').add({
      userId,
      messageText,
      targetChannels,
      scheduledFor, // ISO date string
      imageUrl: imageUrl || null,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    return res.json({ success: true, id: docRef.id });
  } catch (error: any) {
    console.error('[/api/offers/schedule]', error.message);
    return res.status(500).json({ error: 'Erro ao agendar oferta.' });
  }
});

export default router;
