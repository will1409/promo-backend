import { db } from '../config/firebase';

export type PlanType = 'blocked' | 'lite' | 'pro' | 'premium';

export const PLAN_LIMITS = {
  blocked: { channels: 0, campaigns: 0, dailyOffers: 0 },
  lite: { channels: 1, campaigns: 1, dailyOffers: 5 },
  pro: { channels: 3, campaigns: 2, dailyOffers: 10 },
  premium: { channels: 5, campaigns: 3, dailyOffers: 20 },
};

/**
 * Retorna o plano do usuário. Se não existir, retorna 'lite'.
 */
export async function getUserPlan(userId: string): Promise<PlanType> {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      if (data?.plan && Object.keys(PLAN_LIMITS).includes(data.plan)) {
        return data.plan as PlanType;
      }
    }
    return 'blocked'; // Default fallback: total block
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
