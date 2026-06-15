import cron from 'node-cron';
import { db } from '../config/firebase';

export const startScheduler = () => {
  console.log('⏳ Iniciando CronJob de Agendamentos...');
  
  // Roda a cada 1 minuto
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date().toISOString();
      
      // Busca agendamentos pendentes (filtra por data na memória para evitar erro de Index do Firestore)
      const snapshot = await db.collection('scheduled_offers')
        .where('status', '==', 'pending')
        .get();

      if (snapshot.empty) return;

      const pendingDocs = snapshot.docs.filter(doc => {
        const data = doc.data();
        return data.scheduledFor <= now;
      });

      if (pendingDocs.length === 0) return;

      console.log(`🚀 Executando ${pendingDocs.length} agendamentos pendentes...`);

      for (const doc of pendingDocs) {
        const schedule = doc.data();
        const { userId, messageText, targetChannels } = schedule;

        let sentCount = 0;

        // Dispara para cada canal selecionado
        for (const channel of targetChannels) {
          try {
            // Dispara para cada canal usando a mesma rota de envio da dashboard
            const port = process.env.PORT || 3001;
            const res = await fetch(`http://127.0.0.1:${port}/api/channels/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId,
                channelType: channel.type,
                targetId: channel.targetId,
                message: messageText,
                imageUrl: schedule.imageUrl
              })
            });
            const data: any = await res.json();
            if (data.success) {
              sentCount++;
            } else {
              console.error(`Erro na API de envio:`, data.error);
            }
            
            // Atualiza o totalSent do canal
            const channelRef = db.doc(`users/${userId}/channels/${channel.id}`);
            const channelSnap = await channelRef.get();
            if (channelSnap.exists) {
              const cData = channelSnap.data();
              await channelRef.update({
                totalSent: (cData?.totalSent || 0) + 1,
                lastSent: 'Automático'
              });
            }
          } catch (e) {
            console.error(`Erro ao disparar agendamento ${doc.id} para ${channel.name}:`, e);
          }
        }

        // Marca como concluído
        await doc.ref.update({
          status: 'sent',
          sentAt: new Date().toISOString(),
          sentCount
        });
        
        console.log(`✅ Agendamento ${doc.id} concluído. (${sentCount} disparos)`);
      }
    } catch (error) {
      console.error('Erro no cron scheduler:', error);
    }
  });
};
