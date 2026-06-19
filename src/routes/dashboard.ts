import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../config/firebase';
import admin from 'firebase-admin';

const router = Router();

// GET /api/dashboard/r/:offerId — Rota de Redirecionamento e Rastreamento de Cliques
router.get('/r/:offerId', async (req: Request, res: Response) => {
  try {
    const { offerId } = req.params;
    const { src } = req.query; // src: 'telegram', 'whatsapp', 'instagram'
    
    const offerRef = db.collection('offers').doc(offerId);
    const offerSnap = await offerRef.get();
    
    if (!offerSnap.exists) {
      return res.status(404).send('Oferta não encontrada no banco de dados.');
    }
    
    const offerData = offerSnap.data() || {};
    const destUrl = offerData.affiliateLink;
    
    if (!destUrl) {
      return res.status(400).send('Link de destino não configurado nesta oferta.');
    }
    
    // Incrementar clique no Firestore
    const sourceKey = typeof src === 'string' ? src.toLowerCase() : 'outros';
    
    await offerRef.update({
      clicks: admin.firestore.FieldValue.increment(1),
      [`clicksBySource.${sourceKey}`]: admin.firestore.FieldValue.increment(1)
    });
    
    // Redireciona para o link final do afiliado
    return res.redirect(destUrl);
  } catch (error: any) {
    console.error('Error in redirect route:', error);
    return res.status(500).send('Erro interno ao processar o redirecionamento.');
  }
});

// GET /api/dashboard/:userId — Retorna as estatísticas gerais do usuário
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Buscar Ofertas
    const offersSnapshot = await db.collection('offers')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
      
    // Buscar quantidade de campanhas
    const campaignsSnapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .get();
      
    let totalOffers = offersSnapshot.size;
    let totalClicks = 0;
    
    const trafficSources = {
      Telegram: 0,
      WhatsApp: 0,
      Instagram: 0,
      Outros: 0
    };

    offersSnapshot.docs.forEach(doc => {
      const data = doc.data();
      totalClicks += (data.clicks || 0);
      
      const sources = data.clicksBySource || {};
      trafficSources.Telegram += (sources.telegram || 0);
      trafficSources.WhatsApp += (sources.whatsapp || 0);
      trafficSources.Instagram += (sources.instagram || 0);
      trafficSources.Outros += (sources.outros || 0);
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

    // Selecionar as últimas 5 ofertas
    const recentOffers = offersSnapshot.docs.slice(0, 5).map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        productName: data.productName,
        platform: data.platform || 'Desconhecida',
        clicks: data.clicks || 0,
        status: 'Ativo',
        createdAt: data.createdAt
      };
    });

    const stats = {
      totalOffers,
      totalClicks,
      campaigns: campaignsSnapshot.size,
      conversionRate: totalOffers > 0 ? 4.2 : 0, // Mock rate (vendas / cliques não mapeadas)
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
