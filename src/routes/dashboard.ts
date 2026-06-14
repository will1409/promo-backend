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
    
    const trafficSources = {
      Telegram: 0,
      WhatsApp: 0,
      Instagram: 0,
      Outros: 0
    };

    // Buscar Links para somar os cliques reais de redirecionamento e fontes
    const linksSnapshot = await db.collection('links')
      .where('userId', '==', userId)
      .get();

    linksSnapshot.forEach(doc => {
      const data = doc.data();
      totalClicks += data.clicks || 0;
      if (data.clicksBySource) {
        trafficSources.Telegram += data.clicksBySource.Telegram || 0;
        trafficSources.WhatsApp += data.clicksBySource.WhatsApp || 0;
        trafficSources.Instagram += data.clicksBySource.Instagram || 0;
        trafficSources.Outros += data.clicksBySource.Outros || 0;
      }
    });

    // Calcular as porcentagens do tráfego
    const totalSourceClicks = trafficSources.Telegram + trafficSources.WhatsApp + trafficSources.Instagram + trafficSources.Outros;
    
    const trafficMetrics = [
      { label: 'Telegram', value: trafficSources.Telegram },
      { label: 'WhatsApp', value: trafficSources.WhatsApp },
      { label: 'Instagram', value: trafficSources.Instagram },
      { label: 'Outros', value: trafficSources.Outros },
    ].sort((a, b) => b.value - a.value).slice(0, 3).map(item => ({
      label: item.label,
      pct: totalSourceClicks > 0 ? `${Math.round((item.value / totalSourceClicks) * 100)}%` : '0%',
      rawPct: totalSourceClicks > 0 ? Math.round((item.value / totalSourceClicks) * 100) : 0
    }));

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
      recentOffers,
      trafficMetrics
    };

    return res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[/api/dashboard/:userId]', error.message);
    return res.status(500).json({ error: 'Erro ao buscar estatísticas do dashboard.' });
  }
});

export default router;
