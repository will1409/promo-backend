import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../config/firebase';

const router = Router();

// GET /api/dashboard/:userId — Retorna as estatísticas gerais do usuário
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Buscar Ofertas
    const offersSnapshot = await db.collection('offers')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
      
    let totalOffers = offersSnapshot.size;
    let totalClicks = 0;

    // Buscar Links para somar os cliques reais de redirecionamento
    const linksSnapshot = await db.collection('links')
      .where('userId', '==', userId)
      .get();

    linksSnapshot.forEach(doc => {
      const data = doc.data();
      totalClicks += data.clicks || 0;
    });

    // Como as ofertas ainda não registram "cliques diretos" no preview,
    // os "cliques" no dashboard serão a soma de cliques nos Links encurtados.
    // Campanhas podem ser o número de links ou ofertas, ou simplesmente hardcoded se não houver o módulo.
    // Vamos chamar "Total Ofertas" como total de itens gerados.

    // Selecionar as últimas 5 ofertas
    const recentOffers = offersSnapshot.docs.slice(0, 5).map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        productName: data.productName,
        platform: data.platform || 'Desconhecida',
        clicks: data.clicks || 0, // se ofertas passarem a ter cliques
        status: 'Ativo',
        createdAt: data.createdAt
      };
    });

    const stats = {
      totalOffers,
      totalClicks,
      campaigns: totalOffers > 0 ? Math.max(1, Math.floor(totalOffers / 3)) : 0, // Mock de campanhas baseadas em ofertas por enquanto
      conversionRate: totalOffers > 0 ? 4.2 : 0, // Mock rate
      recentOffers
    };

    return res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[/api/dashboard/:userId]', error.message);
    return res.status(500).json({ error: 'Erro ao buscar estatísticas do dashboard.' });
  }
});

export default router;
