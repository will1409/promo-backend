/**
 * Script para alterar o trial grátis de 3 para 7 dias para todos os usuários existentes
 * (exceto os que possuem plano vitalício).
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

if (!admin.apps.length) {
  const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountStr) {
    const serviceAccount = JSON.parse(serviceAccountStr);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'pegue-a-promo',
    });
  } else {
    admin.initializeApp({
      projectId: 'pegue-a-promo',
      credential: admin.credential.applicationDefault(),
    });
  }
}

const db = admin.firestore();

async function run() {
  console.log('Iniciando atualização de usuários (Trial de 3 para 7 dias)...');
  const usersSnapshot = await db.collection('users').get();
  let updatedCount = 0;

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    
    // Ignorar se for vitalício
    if (data.subscriptionStatus === 'LIFETIME') {
      continue;
    }

    // Se tiver trialEndsAt, aumentamos 4 dias (passando o total de 3 para 7 dias).
    if (data.trialEndsAt) {
      const currentEnd = new Date(data.trialEndsAt);
      const newEnd = new Date(currentEnd.getTime() + 4 * 24 * 60 * 60 * 1000);
      
      await doc.ref.update({
        trialEndsAt: newEnd.toISOString()
      });
      
      console.log(`Usuário ${data.email || doc.id} atualizado. Trial extendido para ${newEnd.toISOString()}`);
      updatedCount++;
    }
  }

  console.log(`Concluído! ${updatedCount} usuários tiveram seu trial extendido.`);
  process.exit(0);
}

run().catch(console.error);
