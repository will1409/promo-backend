import cron from 'node-cron';
import { db } from '../config/firebase';
import { fetchPageData } from '../routes/creatives';
import { generateCreativeFlow, generateOfferFlow } from '../genkit';

export const startScheduler = () => {
  console.log('⏳ Iniciando CronJob de Agendamentos e Campanhas...');
  
  // Roda a cada 1 minuto
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date().toISOString();
      const port = process.env.PORT || 3001;

      // ============================================
      // LÓGICA DE AGENDAMENTOS (Agendamentos Unitários)
      // ============================================
      const scheduledSnapshot = await db.collection('scheduled_offers')
        .where('status', '==', 'pending')
        .get();

      if (!scheduledSnapshot.empty) {
        const pendingDocs = scheduledSnapshot.docs.filter(doc => doc.data().scheduledFor <= now);
        
        for (const doc of pendingDocs) {
          const schedule = doc.data();
          const { userId, messageText, targetChannels } = schedule;
          let sentCount = 0;

          for (const channel of targetChannels) {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/api/channels/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId,
                  channelType: channel.type,
                  targetId: channel.targetId || channel.id, // Fallback for schema variance
                  message: messageText,
                  imageUrl: schedule.imageUrl
                })
              });
              const data: any = await res.json();
              if (data.success) {
                sentCount++;
                const channelRef = db.doc(`users/${userId}/channels/${channel.id}`);
                const channelSnap = await channelRef.get();
                if (channelSnap.exists) {
                  const cData = channelSnap.data();
                  await channelRef.update({ totalSent: (cData?.totalSent || 0) + 1, lastSent: 'Automático' });
                }
              }
            } catch (e) {
              console.error(`Erro ao disparar agendamento ${doc.id} para ${channel.name}:`, e);
            }
          }

          await doc.ref.update({
            status: 'sent',
            sentAt: new Date().toISOString(),
            sentCount
          });
          console.log(`✅ Agendamento ${doc.id} concluído. (${sentCount} disparos)`);
        }
      }

      // ============================================
      // LÓGICA DE CAMPANHAS (Esteira de Postagem Automática)
      // ============================================
      const campaignsSnapshot = await db.collection('campaigns')
        .where('status', '==', 'active')
        .get();

      if (!campaignsSnapshot.empty) {
        const activeCampaigns = campaignsSnapshot.docs.filter(doc => doc.data().nextRunAt <= now);
        
        for (const doc of activeCampaigns) {
          const campaign = doc.data();
          const { userId, links, targetChannels, currentIndex, intervalMinutes, name } = campaign;
          
          if (currentIndex >= links.length) {
            await doc.ref.update({ status: 'finished' });
            continue;
          }

          const linkUrl = links[currentIndex];
          console.log(`🚀 Processando link da campanha [${name}]: ${linkUrl}`);

          try {
            // 1. Fetch Integration Settings
            let integrations: any = {};
            try {
              const docSnap = await db.doc(`users/${userId}/settings/integrations`).get();
              if (docSnap.exists) integrations = docSnap.data() || {};
            } catch (e) {
              console.error('Erro ao buscar integrações:', e);
            }

            // 2. Extrair dados da página original
            console.log(`Buscando dados da página para: ${linkUrl}`);
            const extracted = await fetchPageData(linkUrl, integrations);
            const imageUrl = extracted.imageUrl || null;
            
            let platform = 'desconhecida';
            if (linkUrl.includes('amazon') || linkUrl.includes('amzn')) platform = 'amazon';
            else if (linkUrl.includes('shopee') || linkUrl.includes('shp')) platform = 'shopee';
            else if (linkUrl.includes('mercadolivre') || linkUrl.includes('meli')) platform = 'mercadolivre';

            // 3. Gerar textos de oferta usando IA
            console.log(`Gerando IA para: ${extracted.productName}`);
            const aiOffer = await generateOfferFlow({
              productName: extracted.productName || 'Oferta Imperdível',
              currentPrice: extracted.price || 'Confira no site',
              oldPrice: extracted.oldPrice || '',
              category: '',
              platform,
              affiliateLink: linkUrl
            });

            // 4. Enviar para os canais
            let sentCount = 0;
            for (const channel of targetChannels) {
              let msgContent = `Confira esta oferta: ${linkUrl}`;
              if (channel.type === 'whatsapp') msgContent = aiOffer.whatsapp;
              else if (channel.type === 'telegram') msgContent = aiOffer.telegram;
              else if (channel.type === 'instagram') msgContent = aiOffer.instagram;
              
              try {
                const res = await fetch(`http://127.0.0.1:${port}/api/channels/send`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId,
                    channelType: channel.type,
                    targetId: channel.targetId || channel.id,
                    message: msgContent,
                    imageUrl: imageUrl
                  })
                });
                const data: any = await res.json();
                if (data.success) {
                  sentCount++;
                  // Atualiza totalSent
                  const channelRef = db.doc(`users/${userId}/channels/${channel.id}`);
                  const channelSnap = await channelRef.get();
                  if (channelSnap.exists) {
                    const cData = channelSnap.data();
                    await channelRef.update({ totalSent: (cData?.totalSent || 0) + 1, lastSent: 'Automático (Campanha)' });
                  }
                } else {
                  console.error(`Erro ao enviar esteira para canal:`, data.error);
                }
              } catch (err) {
                console.error('Erro na requisição interna de envio (Campanha):', err);
              }
            }
            
            console.log(`✅ Link da campanha processado. Disparado para ${sentCount} canais.`);

            // 7. Update Campaign Status
            const nextIndex = currentIndex + 1;
            const newStatus = nextIndex >= links.length ? 'finished' : 'active';
            const nextRunDate = new Date(Date.now() + intervalMinutes * 60000).toISOString();

            await doc.ref.update({
              currentIndex: nextIndex,
              status: newStatus,
              nextRunAt: nextRunDate
            });

          } catch (e: any) {
            console.error(`❌ Erro ao processar link da campanha ${doc.id}:`, e.message);
            // On error, skip to next link to avoid getting stuck
            const nextIndex = currentIndex + 1;
            const newStatus = nextIndex >= links.length ? 'finished' : 'active';
            const nextRunDate = new Date(Date.now() + intervalMinutes * 60000).toISOString();
            await doc.ref.update({
              currentIndex: nextIndex,
              status: newStatus,
              nextRunAt: nextRunDate
            });
          }
        }
      }

    } catch (error) {
      console.error('Erro no cron scheduler:', error);
    }
  });
};
