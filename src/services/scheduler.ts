import cron from 'node-cron';
import { db } from '../config/firebase';

export const startScheduler = () => {
  console.log('⏳ Iniciando CronJob de Agendamentos...');
  
  // Roda a cada 1 minuto
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date().toISOString();
      
      // Busca agendamentos pendentes cuja data já chegou ou passou
      const snapshot = await db.collection('scheduled_offers')
        .where('status', '==', 'pending')
        .where('scheduledFor', '<=', now)
        .get();

      if (snapshot.empty) return;

      console.log(`🚀 Executando ${snapshot.size} agendamentos pendentes...`);

      for (const doc of snapshot.docs) {
        const schedule = doc.data();
        const { userId, messageText, targetChannels } = schedule;

        let sentCount = 0;

        // Dispara para cada canal selecionado
        for (const channel of targetChannels) {
          try {
            if (channel.type === 'telegram') {
              const userDoc = await db.collection('users').doc(userId).collection('settings').doc('integrations').get();
              const integrations = userDoc.data() || {};
              const token = integrations.telegramBotToken;
              if (token) {
                if (schedule.imageUrl) {
                  await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: channel.targetId, photo: schedule.imageUrl, caption: messageText, parse_mode: 'HTML' })
                  });
                } else {
                  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: channel.targetId, text: messageText, parse_mode: 'HTML' })
                  });
                }
                sentCount++;
              }
            } else if (channel.type === 'whatsapp') {
              const { sendWhatsAppMessage } = require('./whatsapp');
              await sendWhatsAppMessage(userId, channel.targetId, messageText, schedule.imageUrl);
              sentCount++;
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
