import { db } from '../config/firebase';
import type { Request, Response, NextFunction } from 'express';

export type PlanType = 'blocked' | 'lite' | 'pro' | 'premium';

export type SubscriptionStatusType =
  | 'TRIAL' | 'PENDING' | 'ACTIVE' | 'OVERDUE'
  | 'EXPIRED' | 'CANCELED' | 'SUSPENDED' | 'BLOCKED' | 'LIFETIME';

export const PLAN_LIMITS = {
  blocked: { channels: 0, campaigns: 0, dailyOffers: 0 },
  lite:    { channels: 1, campaigns: 1, dailyOffers: 5  },
  pro:     { channels: 3, campaigns: 2, dailyOffers: 10 },
  premium: { channels: 5, campaigns: 3, dailyOffers: 20 },
};

/** E-mails com acesso admin (nunca bloqueados) */
const ADMIN_EMAILS = ['novoendwill@gmail.com'];

/**
 * Retorna o plano efetivo do usuário.
 * Se a assinatura estiver OVERDUE ou CANCELED, retorna 'blocked'.
 */
export async function getUserPlan(userId: string): Promise<PlanType> {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return 'blocked';

    const data = userDoc.data()!;
    const subscriptionStatus: SubscriptionStatusType = data.subscriptionStatus;

    // Admin nunca é bloqueado
    if (data.email && ADMIN_EMAILS.includes(data.email)) {
      return (data.plan as PlanType) || 'premium';
    }

    // Se assinatura vencida ou cancelada → bloquear
    if (subscriptionStatus === 'OVERDUE' || subscriptionStatus === 'CANCELED'
       || subscriptionStatus === 'BLOCKED' || subscriptionStatus === 'EXPIRED') {
      return 'blocked';
    }

    // Se for TRIAL, verifica se expirou
    if (subscriptionStatus === 'TRIAL') {
      const trialEndsAt = data.trialEndsAt ? new Date(data.trialEndsAt) : null;
      if (!trialEndsAt || trialEndsAt.getTime() < Date.now()) {
        return 'blocked';
      }
    }

    if (data.plan && Object.keys(PLAN_LIMITS).includes(data.plan)) {
      return data.plan as PlanType;
    }

    return 'blocked';
  } catch (err) {
    console.error('Error fetching user plan:', err);
    return 'blocked';
  }
}

/**
 * Retorna os limites numéricos para o usuário.
 */
export async function getUserLimits(userId: string) {
  const plan = await getUserPlan(userId);
  return PLAN_LIMITS[plan];
}

/**
 * Middleware Express — verifica se o usuário tem assinatura ATIVA.
 * Rejeita com 403 se não tiver.
 * Uso: router.post('/rota', verifySubscription, handler)
 */
export function verifySubscription(req: Request, res: Response, next: NextFunction) {
  const userId = req.body?.userId || req.params?.userId || req.query?.userId as string;

  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }

  db.collection('users').doc(userId).get()
    .then(docSnap => {
      if (!docSnap.exists) {
        return res.status(403).json({ error: 'Usuário sem assinatura ativa', code: 'NO_SUBSCRIPTION' });
      }

      const data = docSnap.data()!;
      const status: SubscriptionStatusType = data.subscriptionStatus;
      const email: string = data.email || '';

      // Admins têm acesso total
      if (ADMIN_EMAILS.includes(email)) return next();

      if (status === 'TRIAL') {
        const trialEndsAt = data.trialEndsAt ? new Date(data.trialEndsAt) : null;
        if (!trialEndsAt || trialEndsAt.getTime() < Date.now()) {
          return res.status(403).json({
            error: 'Seu período de teste grátis expirou. Escolha um plano para continuar lucrando.',
            code: 'TRIAL_EXPIRED',
            status: 'EXPIRED'
          });
        }
      }

      const allowedStatuses: SubscriptionStatusType[] = ['ACTIVE', 'TRIAL', 'LIFETIME'];
      if (!status || !allowedStatuses.includes(status)) {
        return res.status(403).json({
          error: 'Assinatura inativa ou vencida. Regularize seu pagamento.',
          code: 'SUBSCRIPTION_INACTIVE',
          status,
        });
      }

      return next();
    })
    .catch(err => {
      console.error('[verifySubscription]', err);
      return res.status(500).json({ error: 'Erro ao verificar assinatura' });
    });
}
