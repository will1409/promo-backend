/**
 * ═══════════════════════════════════════════════════════════
 *  ASAAS ROUTES — Linkou IA
 *  Gerencia assinaturas, pagamentos e webhooks do Asaas.
 *
 *  Endpoints autenticados (usuário):
 *    POST   /api/asaas/subscribe        → Criar assinatura
 *    GET    /api/asaas/subscription/:uid → Dados da assinatura
 *    GET    /api/asaas/payments/:uid    → Histórico de pagamentos
 *    POST   /api/asaas/cancel/:uid      → Cancelar assinatura
 *    POST   /api/asaas/upgrade/:uid     → Trocar plano
 *
 *  Endpoint público (Asaas chama):
 *    POST   /api/asaas/webhook          → Receber eventos do Asaas
 *
 *  IMPORTANTE: Configurar no painel Asaas:
 *    Configurações → Notificações → Webhook URL:
 *    https://187-127-18-22.nip.io/api/asaas/webhook
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import admin from 'firebase-admin';
import { db } from '../config/firebase';
import {
  createOrGetCustomer,
  createSubscription,
  cancelSubscription,
  updateSubscriptionPlan,
  getSubscriptionPayments,
  getPixQrCode,
  PLAN_TRIAL_DAYS,
  PLAN_VALUES,
  PLAN_NAMES,
} from '../services/asaas';
import { sendNotification } from '../services/notifications';

const router = Router();

// ════════════════════════════════════════════════════════════
// POST /api/asaas/subscribe
// Inicia uma assinatura para o usuário
// ════════════════════════════════════════════════════════════
router.post('/subscribe', async (req: Request, res: Response) => {
  const { userId, planId, billingType, creditCard, creditCardHolderInfo } = req.body;

  if (!userId || !planId || !billingType) {
    return res.status(400).json({ error: 'Campos obrigatórios: userId, planId, billingType' });
  }

  if (!['PIX', 'CREDIT_CARD'].includes(billingType)) {
    return res.status(400).json({ error: 'billingType deve ser PIX ou CREDIT_CARD' });
  }

  if (!PLAN_VALUES[planId]) {
    return res.status(400).json({ error: `Plano inválido: ${planId}` });
  }

  try {
    // Busca dados do usuário no Firebase Auth
    const userRecord = await admin.auth().getUser(userId);
    const userName = userRecord.displayName || userRecord.email?.split('@')[0] || 'Usuário';
    const userEmail = userRecord.email || '';

    if (!userEmail) {
      return res.status(400).json({ error: 'Usuário sem email cadastrado' });
    }

    // Verifica se já tem assinatura ativa
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    if (userData?.subscriptionStatus === 'ACTIVE' && userData?.subscriptionId) {
      return res.status(409).json({ error: 'Usuário já possui assinatura ativa. Use upgrade para trocar de plano.' });
    }

    // Cria ou recupera o Customer no Asaas
    const customerId = await createOrGetCustomer(userId, userName, userEmail);

    // Cria a assinatura no Asaas
    const remoteIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
    const subscription = await createSubscription({
      customerId,
      planId,
      billingType,
      remoteIp,
      creditCard: billingType === 'CREDIT_CARD' ? creditCard : undefined,
      creditCardHolderInfo: billingType === 'CREDIT_CARD' ? creditCardHolderInfo : undefined,
    });

    // Busca PIX QR Code se for PIX
    let pixData: any = null;
    if (billingType === 'PIX') {
      try {
        const payments = await getSubscriptionPayments(subscription.id);
        const pendingPayment = payments.find((p: any) => p.status === 'PENDING') || payments[0];
        if (pendingPayment?.id) {
          pixData = await getPixQrCode(pendingPayment.id);
          pixData.paymentId = pendingPayment.id;
          pixData.value = pendingPayment.value;
          pixData.dueDate = pendingPayment.dueDate;

          // Salva pagamento pendente no Firestore
          await savePaymentToFirestore(pendingPayment, userId, subscription.id);
        }
      } catch (e) {
        console.warn('[Asaas/subscribe] Erro ao buscar PIX QR code:', e);
      }
    }

    // Salva dados da assinatura no Firestore
    const now = new Date().toISOString();
    await db.collection('users').doc(userId).update({
      asaasCustomerId: customerId,
      subscriptionId: subscription.id,
      planId,
      subscriptionStatus: 'PENDING',
      billingType,
      nextDueDate: subscription.nextDueDate || '',
      subscriptionCreatedAt: now,
      subscriptionUpdatedAt: now,
      updatedAt: now,
    });

    // Notificação interna
    await sendNotification(userId, 'SUBSCRIPTION_CREATED', {
      plan: PLAN_NAMES[planId],
      trialDays: PLAN_TRIAL_DAYS,
    });

    // Log de auditoria
    await db.collection('auditLogs').add({
      userId,
      action: 'SUBSCRIPTION_CREATED',
      planId,
      billingType,
      subscriptionId: subscription.id,
      createdAt: now,
    });

    return res.json({
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      nextDueDate: subscription.nextDueDate,
      paymentLink: subscription.paymentLink || null,
      pixData,
    });
  } catch (error: any) {
    console.error('[/api/asaas/subscribe]', error.message);
    return res.status(500).json({ error: error.message || 'Erro ao criar assinatura' });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/asaas/subscription/:userId
// Dados completos da assinatura do usuário
// ════════════════════════════════════════════════════════════
router.get('/subscription/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userData = userDoc.data() || {};

    if (!userData.subscriptionId) {
      return res.json({ hasSubscription: false });
    }

    // Busca pagamentos do Firestore (subcollection)
    const paymentsSnap = await db
      .collection('users').doc(userId)
      .collection('payments')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const payments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    return res.json({
      hasSubscription: true,
      subscriptionId: userData.subscriptionId,
      planId: userData.planId,
      plan: userData.plan,
      subscriptionStatus: userData.subscriptionStatus,
      billingType: userData.billingType,
      nextDueDate: userData.nextDueDate,
      lastPaymentDate: userData.lastPaymentDate,
      lastPaymentValue: userData.lastPaymentValue,
      isPremium: userData.isPremium,
      payments,
    });
  } catch (error: any) {
    console.error('[/api/asaas/subscription]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/asaas/payments/:userId
// Histórico completo de pagamentos
// ════════════════════════════════════════════════════════════
router.get('/payments/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const paymentsSnap = await db
      .collection('users').doc(userId)
      .collection('payments')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const payments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ success: true, payments });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/asaas/cancel/:userId
// Cancela assinatura do usuário
// ════════════════════════════════════════════════════════════
router.post('/cancel/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { reason } = req.body;

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData?.subscriptionId) {
      return res.status(400).json({ error: 'Usuário sem assinatura ativa' });
    }

    // Cancela no Asaas
    await cancelSubscription(userData.subscriptionId);

    // Atualiza Firestore — bloqueia IMEDIATAMENTE
    const now = new Date().toISOString();
    await db.collection('users').doc(userId).update({
      subscriptionStatus: 'CANCELED',
      isPremium: false,
      plan: 'blocked',
      subscriptionUpdatedAt: now,
      updatedAt: now,
      cancelReason: reason || 'Cancelado pelo usuário',
      canceledAt: now,
    });

    await sendNotification(userId, 'SUBSCRIPTION_CANCELED');

    await db.collection('auditLogs').add({
      userId,
      action: 'SUBSCRIPTION_CANCELED',
      reason: reason || 'Usuário solicitou cancelamento',
      subscriptionId: userData.subscriptionId,
      createdAt: now,
    });

    return res.json({ success: true });
  } catch (error: any) {
    console.error('[/api/asaas/cancel]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/asaas/upgrade/:userId
// Troca de plano (upgrade ou downgrade)
// ════════════════════════════════════════════════════════════
router.post('/upgrade/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { planId } = req.body;

  if (!planId || !PLAN_VALUES[planId]) {
    return res.status(400).json({ error: 'planId inválido' });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData?.subscriptionId) {
      return res.status(400).json({ error: 'Usuário sem assinatura ativa' });
    }

    const oldPlanId = userData.planId;
    if (oldPlanId === planId) {
      return res.status(400).json({ error: 'Usuário já está neste plano' });
    }

    // Atualiza no Asaas (pró-rata automático)
    await updateSubscriptionPlan(userData.subscriptionId, planId);

    const now = new Date().toISOString();
    await db.collection('users').doc(userId).update({
      planId,
      plan: planId,
      isPremium: planId === 'premium',
      subscriptionUpdatedAt: now,
      updatedAt: now,
    });

    await sendNotification(userId, 'PLAN_CHANGED', {
      fromPlan: PLAN_NAMES[oldPlanId] || oldPlanId,
      toPlan: PLAN_NAMES[planId],
    });

    await db.collection('auditLogs').add({
      userId,
      action: 'PLAN_CHANGED',
      fromPlan: oldPlanId,
      toPlan: planId,
      subscriptionId: userData.subscriptionId,
      createdAt: now,
    });

    return res.json({ success: true, newPlan: planId });
  } catch (error: any) {
    console.error('[/api/asaas/upgrade]', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/asaas/webhook
// Recebe TODOS os eventos do Asaas (endpoint PÚBLICO)
// ════════════════════════════════════════════════════════════
router.post('/webhook', async (req: Request, res: Response) => {
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const providedToken = req.headers['asaas-access-token'];

  // Validar token do webhook se configurado no .env
  if (webhookToken && providedToken !== webhookToken) {
    console.warn(`[Webhook] Token inválido recebido: ${providedToken}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;
  const eventType: string = payload?.event || 'UNKNOWN';
  const eventId: string = payload?.payment?.id || payload?.subscription?.id
    ? `${eventType}_${payload?.payment?.id || payload?.subscription?.id}`
    : `${eventType}_${Date.now()}`;

  console.log(`[Webhook Asaas] ← ${eventType} | id: ${eventId}`);

  // Sempre responde 200 IMEDIATAMENTE para o Asaas não retentar
  res.status(200).json({ received: true });

  // ─── Idempotência — evita processar o mesmo evento duas vezes ───
  try {
    const existingLog = await db.collection('webhookLogs').doc(eventId).get();
    if (existingLog.exists && existingLog.data()?.processed === true) {
      console.log(`[Webhook] Evento ${eventId} já processado. Ignorando.`);
      return;
    }
  } catch (e) {
    console.warn('[Webhook] Falha na verificação de idempotência:', e);
  }

  const now = new Date().toISOString();

  // Salva log do webhook
  try {
    await db.collection('webhookLogs').doc(eventId).set({
      eventId,
      eventType,
      payload,
      processed: false,
      processedAt: null,
      error: null,
      createdAt: now,
    }, { merge: true });
  } catch (e) {
    console.error('[Webhook] Falha ao salvar log:', e);
  }

  // Processa o evento
  try {
    await processWebhookEvent(eventType, payload);

    await db.collection('webhookLogs').doc(eventId).update({
      processed: true,
      processedAt: new Date().toISOString(),
    });

    console.log(`[Webhook] ✅ ${eventType} processado com sucesso`);
  } catch (error: any) {
    console.error(`[Webhook] ❌ Erro ao processar ${eventType}:`, error.message);
    await db.collection('webhookLogs').doc(eventId).update({
      processed: false,
      error: error.message,
    }).catch(() => {});
  }
});

// ════════════════════════════════════════════════════════════
// Helpers internos
// ════════════════════════════════════════════════════════════

async function findUserBySubscriptionId(subscriptionId: string): Promise<string | null> {
  if (!subscriptionId) return null;
  const snap = await db.collection('users')
    .where('subscriptionId', '==', subscriptionId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

async function findUserByCustomerId(customerId: string): Promise<string | null> {
  if (!customerId) return null;
  const snap = await db.collection('users')
    .where('asaasCustomerId', '==', customerId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

async function resolveUserId(payment?: any, subscription?: any): Promise<string | null> {
  // Tenta via subscriptionId
  const subscriptionId = payment?.subscription || subscription?.id;
  if (subscriptionId) {
    const uid = await findUserBySubscriptionId(subscriptionId);
    if (uid) return uid;
  }
  // Tenta via customerId
  const customerId = payment?.customer || subscription?.customer;
  if (customerId) {
    return findUserByCustomerId(customerId);
  }
  return null;
}

/**
 * ⭐ PROTEÇÃO VITALÍCIO — verifica se o usuário tem acesso LIFETIME.
 * Se sim, NENHUM evento do Asaas deve sobrescrever seu status.
 */
async function isLifetimeUser(userId: string): Promise<boolean> {
  try {
    const snap = await db.collection('users').doc(userId).get();
    return snap.exists && snap.data()?.subscriptionStatus === 'LIFETIME';
  } catch (e) {
    console.warn(`[Webhook] Falha ao verificar LIFETIME para userId ${userId}:`, e);
    return false; // em caso de erro, deixa prosseguir (não bloqueia)
  }
}

async function savePaymentToFirestore(payment: any, userId: string, subscriptionId: string) {
  const paymentData = {
    paymentId: payment.id,
    subscriptionId,
    userId,
    valor: payment.value || 0,
    status: payment.status || 'PENDING',
    billingType: payment.billingType || '',
    invoiceUrl: payment.invoiceUrl || '',
    pixQrCode: '',
    pixCopyPaste: '',
    dueDate: payment.dueDate || '',
    paidDate: payment.paymentDate || null,
    createdAt: payment.dateCreated || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Salva na subcollection do usuário (para o frontend)
  await db.collection('users').doc(userId)
    .collection('payments').doc(payment.id)
    .set(paymentData, { merge: true });

  // Salva também na coleção raiz (para o admin)
  await db.collection('payments').doc(payment.id)
    .set(paymentData, { merge: true });
}

// ════════════════════════════════════════════════════════════
// Processador central de eventos do Asaas
// ════════════════════════════════════════════════════════════
async function processWebhookEvent(eventType: string, payload: any): Promise<void> {
  const payment = payload.payment;
  const subscription = payload.subscription;
  const now = new Date().toISOString();

  switch (eventType) {

    // ── PAGAMENTO CONFIRMADO (PIX ou Cartão) ──────────────
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED': {
      const userId = await resolveUserId(payment, subscription);
      if (!userId) {
        console.warn(`[Webhook] Usuário não encontrado para payment: ${payment?.id}`);
        return;
      }

      // ⭐ PROTEÇÃO VITALÍCIO — nunca sobrescreve status LIFETIME
      if (await isLifetimeUser(userId)) {
        console.log(`[Webhook] ⭐ Usuário LIFETIME protegido (PAYMENT_CONFIRMED ignorado): ${userId}`);
        // Ainda salva o pagamento no histórico para auditoria, mas não altera o status
        if (payment?.id) {
          const userDoc = await db.collection('users').doc(userId).get();
          const userData = userDoc.data() || {};
          await savePaymentToFirestore(
            { ...payment, paymentDate: payment.paymentDate || now },
            userId,
            payment.subscription || userData.subscriptionId || ''
          );
        }
        break;
      }

      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data() || {};
      const planId = userData.planId || payment?.externalReference || 'lite';

      // ⭐ LIBERA ACESSO — atualiza o plano no Firestore
      await db.collection('users').doc(userId).update({
        plan: planId,
        subscriptionStatus: 'ACTIVE',
        isPremium: planId === 'premium',
        nextDueDate: payment?.dueDate || userData.nextDueDate || '',
        lastPaymentDate: now,
        lastPaymentValue: payment?.value || 0,
        subscriptionUpdatedAt: now,
        updatedAt: now,
      });

      // Salva o pagamento
      if (payment?.id) {
        await savePaymentToFirestore(
          { ...payment, paymentDate: payment.paymentDate || now },
          userId,
          payment.subscription || userData.subscriptionId || ''
        );
      }

      await sendNotification(userId, 'PAYMENT_CONFIRMED', {
        value: payment?.value,
        plan: PLAN_NAMES[planId] || planId,
      });

      await db.collection('auditLogs').add({
        userId, action: 'PAYMENT_CONFIRMED',
        paymentId: payment?.id, value: payment?.value, plan: planId, createdAt: now,
      });

      console.log(`[Webhook] ✅ Acesso liberado → userId: ${userId} | plano: ${planId}`);
      break;
    }

    // ── PAGAMENTO VENCIDO ─────────────────────────────────
    case 'PAYMENT_OVERDUE': {
      const userId = await resolveUserId(payment, subscription);
      if (!userId) return;

      // ⭐ PROTEÇÃO VITALÍCIO — nunca marca LIFETIME como OVERDUE
      if (await isLifetimeUser(userId)) {
        console.log(`[Webhook] ⭐ Usuário LIFETIME protegido (PAYMENT_OVERDUE ignorado): ${userId}`);
        break;
      }

      await db.collection('users').doc(userId).update({
        subscriptionStatus: 'OVERDUE',
        subscriptionUpdatedAt: now,
        updatedAt: now,
      });

      if (payment?.id) {
        await savePaymentToFirestore(payment, userId, payment.subscription || '');
      }

      await sendNotification(userId, 'PAYMENT_OVERDUE', { value: payment?.value });

      await db.collection('auditLogs').add({
        userId, action: 'PAYMENT_OVERDUE',
        paymentId: payment?.id, createdAt: now,
      });

      console.log(`[Webhook] ⚠️ Pagamento vencido → userId: ${userId}`);
      break;
    }

    // ── PAGAMENTO DELETADO ────────────────────────────────
    case 'PAYMENT_DELETED': {
      const userId = await resolveUserId(payment, subscription);
      if (!userId) return;

      if (payment?.id) {
        await db.collection('users').doc(userId)
          .collection('payments').doc(payment.id)
          .set({ status: 'DELETED', updatedAt: now }, { merge: true });
        await db.collection('payments').doc(payment.id)
          .set({ status: 'DELETED', updatedAt: now }, { merge: true });
      }
      break;
    }

    // ── PAGAMENTO ESTORNADO ───────────────────────────────
    case 'PAYMENT_REFUNDED': {
      const userId = await resolveUserId(payment, subscription);
      if (!userId) return;

      if (payment?.id) {
        await savePaymentToFirestore({ ...payment, status: 'REFUNDED' }, userId, payment.subscription || '');
      }

      await db.collection('auditLogs').add({
        userId, action: 'PAYMENT_REFUNDED',
        paymentId: payment?.id, createdAt: now,
      });

      console.log(`[Webhook] 💸 Estorno registrado → userId: ${userId}`);
      break;
    }

    // ── ASSINATURA CRIADA (confirmação do Asaas) ──────────
    case 'SUBSCRIPTION_CREATED': {
      const customerId = subscription?.customer;
      const userId = await findUserByCustomerId(customerId);
      if (!userId) return;

      // ⭐ PROTEÇÃO VITALÍCIO — não sobrescreve LIFETIME com PENDING
      if (await isLifetimeUser(userId)) {
        console.log(`[Webhook] ⭐ Usuário LIFETIME protegido (SUBSCRIPTION_CREATED ignorado): ${userId}`);
        break;
      }

      await db.collection('users').doc(userId).update({
        subscriptionStatus: 'PENDING',
        subscriptionUpdatedAt: now,
        updatedAt: now,
      });
      break;
    }

    // ── ASSINATURA ATUALIZADA ─────────────────────────────
    case 'SUBSCRIPTION_UPDATED': {
      const customerId = subscription?.customer;
      const userId = await findUserByCustomerId(customerId);
      if (!userId) return;

      await db.collection('users').doc(userId).update({
        subscriptionUpdatedAt: now,
        updatedAt: now,
      });
      break;
    }

    // ── ASSINATURA CANCELADA/DELETADA ─────────────────────
    case 'SUBSCRIPTION_DELETED': {
      const userId = await resolveUserId(undefined, subscription);
      if (!userId) return;

      // ⭐ PROTEÇÃO VITALÍCIO — nunca cancela/bloqueia usuário LIFETIME
      if (await isLifetimeUser(userId)) {
        console.log(`[Webhook] ⭐ Usuário LIFETIME protegido (SUBSCRIPTION_DELETED ignorado): ${userId}`);
        break;
      }

      // 🔒 BLOQUEIA ACESSO IMEDIATAMENTE
      await db.collection('users').doc(userId).update({
        subscriptionStatus: 'CANCELED',
        isPremium: false,
        plan: 'blocked',
        subscriptionUpdatedAt: now,
        updatedAt: now,
      });

      await sendNotification(userId, 'SUBSCRIPTION_CANCELED');

      await db.collection('auditLogs').add({
        userId, action: 'SUBSCRIPTION_DELETED',
        subscriptionId: subscription?.id, createdAt: now,
      });

      console.log(`[Webhook] 🔒 Acesso bloqueado → userId: ${userId}`);
      break;
    }

    default:
      console.log(`[Webhook] Evento não tratado: ${eventType}`);
  }
}

export default router;
