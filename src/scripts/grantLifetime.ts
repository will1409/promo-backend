import * as admin from 'firebase-admin';
import * as path from 'path';

// Carrega as variáveis de ambiente
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountStr) {
  throw new Error('Variável FIREBASE_SERVICE_ACCOUNT não definida.');
}

const serviceAccount = JSON.parse(serviceAccountStr);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function grantLifetime() {
  console.log('🔍 Buscando clientes antigos...');
  
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();
  
  let count = 0;
  
  const batch = db.batch();
  
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    
    // Se o usuário não tem subscriptionStatus (ou seja, foi criado antes do Asaas)
    // OU se a assinatura está como PENDING, EXPIRED e queremos migrar.
    // Vamos focar nos que não tem status definido ou tem status inválido/vazio
    if (!data.subscriptionStatus) {
      batch.update(doc.ref, {
        subscriptionStatus: 'LIFETIME',
        // Se ele não tinha plano, vamos dar o premium padrão, senão mantém o que tem
        plan: data.plan || 'premium'
      });
      console.log(`✅ Acesso vitalício garantido para: ${data.email || doc.id}`);
      count++;
    }
  });

  if (count > 0) {
    await batch.commit();
    console.log(`🎉 Sucesso! ${count} cliente(s) antigo(s) atualizado(s) para acesso vitalício (LIFETIME).`);
  } else {
    console.log('Nenhum cliente antigo sem assinatura foi encontrado.');
  }
}

grantLifetime()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Erro:', err);
    process.exit(1);
  });
