import { db } from './src/config/firebase';
import { getWhatsAppStatus, startWhatsAppSession } from './src/services/whatsapp';

async function run() {
  console.log("=== DIAGNÓSTICO DO AGENDAMENTO E WHATSAPP ===");

  try {
    // 1. Buscar os agendamentos recentes
    const snapshot = await db.collection('scheduled_offers').orderBy('createdAt', 'desc').limit(5).get();
    
    if (snapshot.empty) {
      console.log("Nenhum agendamento encontrado em 'scheduled_offers'.");
      return;
    }

    console.log(`\nEncontrados ${snapshot.size} agendamentos recentes:`);
    for (const doc of snapshot.docs) {
      const data = doc.data();
      console.log(`\nID do Agendamento: ${doc.id}`);
      console.log(`- Status: ${data.status}`);
      console.log(`- ScheduledFor: ${data.scheduledFor}`);
      console.log(`- UserId: ${data.userId}`);
      console.log(`- Canais de Destino:`);
      for (const ch of data.targetChannels || []) {
        console.log(`  * Nome: ${ch.name} | Tipo: ${ch.type} | ID: ${ch.id} | TargetId: ${ch.targetId}`);
        
        // Verifica o documento do canal no Firestore
        const channelSnap = await db.doc(`users/${data.userId}/channels/${ch.id}`).get();
        if (channelSnap.exists) {
          const chData = channelSnap.data();
          console.log(`    [Firestore] Status: ${chData?.status} | TargetId Real: ${chData?.targetId} | Tipo: ${chData?.type}`);
        } else {
          console.log(`    [Firestore] AVISO: Canal não encontrado no Firestore!`);
        }
      }
    }

    // 2. Verificar o status do WhatsApp para o usuário do agendamento mais recente
    const latestSchedule = snapshot.docs[0].data();
    const userId = latestSchedule.userId;
    console.log(`\n=== VERIFICANDO WHATSAPP DO USUÁRIO: ${userId} ===`);
    
    const waStatus = await getWhatsAppStatus(userId);
    console.log("WhatsApp Status retornado:", waStatus);

    // Verifica credenciais diretamente no banco
    const credsSnap = await db.collection('users').doc(userId).collection('whatsapp_auth').doc('creds').get();
    console.log("Credenciais 'creds' existem no Firestore?", credsSnap.exists);
    if (credsSnap.exists) {
      const credsData = credsSnap.data();
      console.log("Chaves contidas em creds:", Object.keys(credsData || {}));
    }

  } catch (err: any) {
    console.error("Erro no diagnóstico:", err.message || err);
  }
}

run();
