import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../config/firebase';
// nanoid v3 é CommonJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { nanoid } = require('nanoid');

const router = Router();

// POST /api/links/shorten — Encurta um link e salva no Firestore
router.post('/shorten', async (req: Request, res: Response) => {
  try {
    const { originalUrl, platform, userId } = req.body;
    if (!originalUrl) {
      return res.status(400).json({ error: 'originalUrl é obrigatório.' });
    }

    const shortCode = nanoid(6);
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const shortUrl = `${baseUrl}/${shortCode}`;

    const linkData = {
      userId: userId || 'anonymous',
      originalUrl,
      shortUrl,
      shortCode,
      platform: platform || 'Outro',
      clicks: 0,
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection('links').add(linkData);

    return res.json({ success: true, data: { id: docRef.id, ...linkData } });
  } catch (error: any) {
    console.error('[/api/links/shorten]', error.message);
    return res.status(500).json({ error: 'Erro ao encurtar link.' });
  }
});

// GET /api/links/:userId — Lista links do usuário
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const snapshot = await db.collection('links').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get();
    const links = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, data: links });
  } catch (error: any) {
    console.error('[/api/links/:userId]', error.message);
    return res.status(500).json({ error: 'Erro ao buscar links.' });
  }
});

// POST /api/links/click/:shortCode — Registra um clique
router.post('/click/:shortCode', async (req: Request, res: Response) => {
  try {
    const { shortCode } = req.params;
    const snapshot = await db.collection('links').where('shortCode', '==', shortCode).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ error: 'Link não encontrado.' });
    }
    const doc = snapshot.docs[0];
    await doc.ref.update({ clicks: (doc.data().clicks || 0) + 1 });
    return res.json({ success: true, redirect: doc.data().originalUrl });
  } catch (error: any) {
    return res.status(500).json({ error: 'Erro ao registrar clique.' });
  }
});

export default router;
