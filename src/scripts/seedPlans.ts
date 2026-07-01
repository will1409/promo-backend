/**
 * Seed script — popula a coleção 'plans' no Firestore.
 * Execute com: npx ts-node -r tsconfig-paths/register src/scripts/seedPlans.ts
 */

import '../config/firebase'; // inicializa o Firebase Admin
import { db } from '../config/firebase';

const plans = [
  {
    id: 'lite',
    name: 'Lite',
    price: 14.90,
    cycle: 'MONTHLY',
    limits: {
      channels: 1,
      campaigns: 1,
      dailyOffers: 5,
    },
    benefits: [
      'Gerador de Ofertas Manual',
      '5 Ofertas/Dia (Gerador Automático)',
      '1 Grupo WhatsApp + 1 Grupo Telegram',
      'Criativos Instagram',
    ],
    missing: ['Campanhas Automáticas', 'Suporte Prioritário'],
    status: 'active',
    displayOrder: 1,
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 39.90,
    cycle: 'MONTHLY',
    limits: {
      channels: 3,
      campaigns: 2,
      dailyOffers: 10,
    },
    benefits: [
      'Gerador de Ofertas Manual',
      '10 Ofertas/Dia (Gerador Automático)',
      '2 Campanhas Ativas',
      '3 Grupos WhatsApp + 3 Grupos Telegram',
      'Criativos Instagram',
    ],
    missing: ['Suporte Prioritário'],
    status: 'active',
    displayOrder: 2,
    highlight: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 69.90,
    cycle: 'MONTHLY',
    limits: {
      channels: 5,
      campaigns: 3,
      dailyOffers: 20,
    },
    benefits: [
      'Gerador de Ofertas Manual',
      '20 Ofertas/Dia (Gerador Automático)',
      '3 Campanhas Ativas',
      '5 Grupos WhatsApp + 5 Grupos Telegram',
      'Criativos Instagram',
      'Suporte Prioritário',
    ],
    missing: [],
    status: 'active',
    displayOrder: 3,
    highlight: false,
  },
];

async function seedPlans() {
  console.log('🌱 Iniciando seed dos planos...\n');

  for (const plan of plans) {
    const { id, ...data } = plan;
    await db.collection('plans').doc(id).set(
      { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { merge: true }
    );
    console.log(`  ✅ Plano "${plan.name}" (R$ ${plan.price.toFixed(2)}) criado/atualizado`);
  }

  console.log('\n🎉 Seed concluído! Verifique a coleção "plans" no Firestore.');
  process.exit(0);
}

seedPlans().catch((e) => {
  console.error('❌ Erro no seed:', e);
  process.exit(1);
});
