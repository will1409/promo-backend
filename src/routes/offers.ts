import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../config/firebase';
import { getUserLimits } from '../utils/planLimits';

const router = Router();

// POST /api/offers/generate — Gera textos com Genkit Gemini
router.post('/generate', async (req: Request, res: Response) => {
  try {
    let { productName, currentPrice, oldPrice, category, platform, affiliateLink, userId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const limits = await getUserLimits(userId);
    if (limits.dailyOffers === 0) {
      return res.status(403).json({ error: 'Seu plano atual não permite gerar ofertas. Faça upgrade para utilizar o sistema.' });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayISO = startOfDay.toISOString();

    const todayOffersSnap = await db.collection('offers')
      .where('userId', '==', userId)
      .where('createdAt', '>=', startOfDayISO)
      .get();

    if (todayOffersSnap.size >= limits.dailyOffers) {
      return res.status(403).json({ error: `Você atingiu o limite de ${limits.dailyOffers} ofertas diárias do seu plano.` });
    }

    if (!productName || productName.trim() === '') productName = 'Oferta Especial';
    if (!currentPrice || currentPrice.toString().trim() === '') currentPrice = 'Confira no site';

    const input = { productName, currentPrice, oldPrice, category, platform, affiliateLink, userId };

    // Gera texto padrão sem IA
    const templateText = '🔥 CONFIRA ESTA OFERTA! 🔥\n\n📦 {nome}\n💵 Apenas {preco}\n\n🛒 Compre aqui: {link}';
    const whatsapp = templateText
      .replace(/{nome}/g, productName)
      .replace(/{preco}/g, currentPrice)
      .replace(/{link}/g, affiliateLink || '');
    
    const telegram = whatsapp;
    const generated = { whatsapp, telegram };

    try {
      await db.collection('offers').add({
        ...input,
        ...generated,
        clicks: 0,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Falha ao salvar no Firestore (possível falta de credenciais):', e);
    }

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

    const limits = await getUserLimits(userId);
    if (limits.dailyOffers === 0) {
      return res.status(403).json({ error: 'Seu plano atual não permite agendar ofertas. Faça upgrade.' });
    }

    if (targetChannels.length > limits.channels) {
      return res.status(403).json({ error: `Seu plano (${limits.channels} canais) não permite o envio para ${targetChannels.length} canais simultâneos.` });
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
