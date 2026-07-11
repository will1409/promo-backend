import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../config/firebase';
import admin from 'firebase-admin';

const router = Router();

// GET /api/admin/users — Lista todos os usuários com status completo
router.get('/users', async (_req: Request, res: Response) => {
  try {
    // 1. Busca todos os usuários do Firebase Auth
    const listUsersResult = await admin.auth().listUsers(1000);
    const authUsers = listUsersResult.users;

    // 2. Para cada usuário, busca dados do Firestore
    const usersData = await Promise.all(authUsers.map(async (authUser) => {
      const userId = authUser.uid;

      try {
        // Status WhatsApp (credenciais salvas)
        const credsSnap = await db
          .collection('users').doc(userId)
          .collection('whatsapp_auth').doc('creds').get();
        const hasWhatsApp = credsSnap.exists;

        // Agendamentos pendentes e total
        const [scheduledSnap, totalScheduledSnap] = await Promise.all([
          db.collection('scheduled_offers')
            .where('userId', '==', userId)
            .where('status', '==', 'pending')
            .get(),
          db.collection('scheduled_offers')
            .where('userId', '==', userId)
            .get(),
        ]);

        // Campanhas ativas
        const campaignsSnap = await db.collection('campaigns')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .get();

        // Total de ofertas geradas
        const offersSnap = await db.collection('offers')
          .where('userId', '==', userId)
          .get();

        // Canais cadastrados
        const channelsSnap = await db
          .collection('users').doc(userId)
          .collection('channels').get();

        // User Document
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        return {
          uid: userId,
          email: authUser.email || '—',
          displayName: authUser.displayName || authUser.email?.split('@')[0] || 'Sem nome',
          createdAt: authUser.metadata.creationTime,
          lastSignIn: authUser.metadata.lastSignInTime,
          hasWhatsApp,
          pendingSchedules: scheduledSnap.size,
          totalSchedules: totalScheduledSnap.size,
          activeCampaigns: campaignsSnap.size,
          totalOffers: offersSnap.size,
          totalChannels: channelsSnap.size,
          planId: userData?.planId || 'lite',
          subscriptionStatus: userData?.subscriptionStatus || 'TRIAL',
        };
      } catch (e) {
        return {
          uid: userId,
          email: authUser.email || '—',
          displayName: authUser.displayName || '—',
          createdAt: authUser.metadata.creationTime,
          lastSignIn: authUser.metadata.lastSignInTime,
          hasWhatsApp: false,
          pendingSchedules: 0,
          totalSchedules: 0,
          activeCampaigns: 0,
          totalOffers: 0,
          totalChannels: 0,
          planId: 'lite',
          subscriptionStatus: 'TRIAL',
          error: 'Erro ao buscar dados do Firestore',
        };
      }
    }));

    // 3. Resumo geral
    const summary = {
      totalUsers: usersData.length,
      withWhatsApp: usersData.filter(u => u.hasWhatsApp).length,
      withActiveCampaigns: usersData.filter(u => u.activeCampaigns > 0).length,
      totalPendingSchedules: usersData.reduce((acc, u) => acc + u.pendingSchedules, 0),
      totalOffersGenerated: usersData.reduce((acc, u) => acc + u.totalOffers, 0),
    };

    return res.json({ success: true, summary, users: usersData });
  } catch (error: any) {
    console.error('[/api/admin/users]', error.message);
    return res.status(500).json({ error: 'Erro ao buscar dados de admin.', details: error.message });
  }
});

// GET /api/admin/wa-sessions — Status das sessões WhatsApp em memória
router.get('/wa-sessions', async (_req: Request, res: Response) => {
  try {
    const { getWhatsAppStatus } = require('../services/whatsapp');
    const listUsersResult = await admin.auth().listUsers(1000);

    const sessions = await Promise.all(
      listUsersResult.users.map(async (u) => {
        const status = await getWhatsAppStatus(u.uid);
        return {
          uid: u.uid,
          email: u.email || '—',
          displayName: u.displayName || u.email?.split('@')[0] || '—',
          waStatus: status.status,
          hasQr: !!status.qr,
        };
      })
    );

    const connected = sessions.filter(s => s.waStatus === 'connected').length;
    const connecting = sessions.filter(s => s.waStatus === 'connecting').length;
    const disconnected = sessions.filter(s => s.waStatus === 'disconnected').length;

    return res.json({
      success: true,
      summary: { connected, connecting, disconnected },
      sessions,
    });
  } catch (error: any) {
    console.error('[/api/admin/wa-sessions]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/debug-channels/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const channelsSnap = await db.collection('users').doc(userId).collection('channels').get();
    const channels = channelsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, channels });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/revenue — Métricas financeiras (MRR, ARR, Churn, assinantes)
router.get('/revenue', async (_req: Request, res: Response) => {
  try {
    const PLAN_VALUES: Record<string, number> = { lite: 14.90, pro: 39.90, premium: 69.90 };
    const listUsersResult = await admin.auth().listUsers(1000);
    const allUids = listUsersResult.users.map(u => u.uid);

    const userDocs = await Promise.all(
      allUids.map(uid => db.collection('users').doc(uid).get())
    );

    const usersData = userDocs
      .filter(d => d.exists)
      .map(d => ({ uid: d.id, ...d.data() as any }));

    const active    = usersData.filter(u => u.subscriptionStatus === 'ACTIVE');
    const overdue   = usersData.filter(u => u.subscriptionStatus === 'OVERDUE');
    const canceled  = usersData.filter(u => u.subscriptionStatus === 'CANCELED');
    const pending   = usersData.filter(u => u.subscriptionStatus === 'PENDING');
    const noSub     = usersData.filter(u => !u.subscriptionStatus);

    // MRR = soma dos planos ativos
    const mrr = active.reduce((sum, u) => sum + (PLAN_VALUES[u.planId] || 0), 0);
    const arr = mrr * 12;

    // Assinantes por plano
    const byPlan = {
      lite:    active.filter(u => u.planId === 'lite').length,
      pro:     active.filter(u => u.planId === 'pro').length,
      premium: active.filter(u => u.planId === 'premium').length,
    };

    // Churn = cancelados do mês / total do mês passado (simplificado)
    const totalSubscribers = active.length + overdue.length + canceled.length;
    const churnRate = totalSubscribers > 0
      ? ((canceled.length / totalSubscribers) * 100).toFixed(1)
      : '0.0';

    return res.json({
      success: true,
      summary: {
        mrr: mrr.toFixed(2),
        arr: arr.toFixed(2),
        activeSubscribers: active.length,
        overdueSubscribers: overdue.length,
        canceledSubscribers: canceled.length,
        pendingSubscribers: pending.length,
        noSubscription: noSub.length,
        totalUsers: usersData.length,
        churnRate: `${churnRate}%`,
        byPlan,
      },
      overdueUsers: overdue.map(u => ({
        uid: u.uid,
        email: listUsersResult.users.find(a => a.uid === u.uid)?.email || '—',
        planId: u.planId,
        nextDueDate: u.nextDueDate,
        lastPaymentDate: u.lastPaymentDate,
      })),
    });
  } catch (error: any) {
    console.error('[/api/admin/revenue]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/users/:userId/status — Atualiza o status da assinatura (ex: CANCELED para bloquear)
router.post('/users/:userId/status', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { subscriptionStatus } = req.body;
    if (!subscriptionStatus) return res.status(400).json({ error: 'Missing subscriptionStatus' });

    await db.collection('users').doc(userId).update({ subscriptionStatus });
    res.json({ success: true, message: `Status de ${userId} alterado para ${subscriptionStatus}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/users/:userId/plan — Altera o plano do usuário
router.post('/users/:userId/plan', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: 'Missing planId' });

    await db.collection('users').doc(userId).update({ planId });
    res.json({ success: true, message: `Plano de ${userId} alterado para ${planId}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

