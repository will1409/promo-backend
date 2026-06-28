import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../config/firebase';
import { getUserLimits } from '../utils/planLimits';

const router = Router();

// POST /api/campaigns/create
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { userId, name, links, targetChannels, intervalMinutes, template } = req.body;
    
    if (!userId || !name || !links || !Array.isArray(links) || links.length === 0 || !targetChannels || !intervalMinutes) {
      return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    }

    if (links.length > 5) {
      return res.status(400).json({ error: 'O limite máximo é de 5 links por campanha.' });
    }

    const limits = await getUserLimits(userId);

    if (limits.campaigns === 0) {
      return res.status(403).json({ error: 'Seu plano atual não permite criar campanhas. Faça upgrade.' });
    }

    if (targetChannels.length > limits.channels) {
      return res.status(403).json({ error: `Seu plano (${limits.channels} canais) não permite o envio para ${targetChannels.length} canais simultâneos.` });
    }

    // 1. Contar quantas campanhas o usuário CRIOU hoje (Limite Diário)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayISO = startOfDay.toISOString();

    const todayCampaignsSnap = await db.collection('campaigns')
      .where('userId', '==', userId)
      .where('createdAt', '>=', startOfDayISO)
      .get();
      
    if (todayCampaignsSnap.size >= limits.campaigns) {
      return res.status(403).json({ error: `Você atingiu o limite de CRIAR ${limits.campaigns} campanha(s) por dia do seu plano.` });
    }

    // 2. Contar campanhas ativas simultâneas (Limite de Concorrência)
    const campaignsSnap = await db.collection('campaigns')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get();
      
    if (campaignsSnap.size >= limits.campaigns) {
      return res.status(403).json({ error: `Você já tem ${limits.campaigns} campanha(s) rodando ao mesmo tempo. Pause ou exclua uma para criar outra (se tiver cota diária).` });
    }

    const docRef = await db.collection('campaigns').add({
      userId,
      name,
      links,
      targetChannels,
      intervalMinutes,
      template: template || '🔥 CONFIRA ESTA OFERTA! 🔥\n\n📦 {nome}\n💵 Apenas {preco}\n\n🛒 Compre aqui: {link}',
      currentIndex: 0,
      status: 'active',
      nextRunAt: new Date(Date.now() + intervalMinutes * 60000).toISOString(),
      createdAt: new Date().toISOString()
    });

    return res.json({ success: true, id: docRef.id });
  } catch (error: any) {
    console.error('[/api/campaigns/create]', error.message);
    return res.status(500).json({ error: 'Erro ao criar campanha.' });
  }
});

// GET /api/campaigns/:userId
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const snapshot = await db.collection('campaigns').where('userId', '==', userId).get();
    const campaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    campaigns.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json({ success: true, data: campaigns });
  } catch (error: any) {
    console.error('[/api/campaigns/:userId]', error.message);
    return res.status(500).json({ error: 'Erro ao buscar campanhas.' });
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.collection('campaigns').doc(id).delete();
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[/api/campaigns/delete]', error.message);
    return res.status(500).json({ error: 'Erro ao deletar campanha.' });
  }
});

export default router;
