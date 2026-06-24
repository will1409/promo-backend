import cron from 'node-cron';
import { db } from '../config/firebase';
import { resolveRedirectPuppeteer, fetchShopeeOfficialApi, scrapeProductPuppeteer } from './scraper';
import { sendMessageHelper } from './sender';

function extractKeywordFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('shopee')) {
      const pathParts = urlObj.pathname.split('/');
      const slug = pathParts.find(p => p.includes('-i.'));
      if (slug) {
        return decodeURIComponent(slug.split('-i.')[0].replace(/-/g, ' '));
      }
    }
  } catch (e) {}
  return "";
}

function extractItemIdFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('shopee')) {
      // 1. Tenta padrão de slug desktop: -i.shopId.itemId
      const matchDesktop = urlObj.pathname.match(/-i\.\d+\.(\d+)/);
      if (matchDesktop && matchDesktop[1]) {
        return matchDesktop[1];
      }
      // 2. Tenta padrão de caminho mobile: /shopName/shopId/itemId
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        const lastPart = pathParts[pathParts.length - 1];
        if (/^\d+$/.test(lastPart)) {
          return lastPart;
        }
      }
    }
  } catch (e) {}
  return "";
}

export const startScheduler = () => {
  console.log('⏳ Iniciando CronJob de Agendamentos e Campanhas...');
  
  let isRunning = false;

  // Roda a cada 1 minuto
  cron.schedule('* * * * *', async () => {
    if (isRunning) {
      console.log('⏳ CronJob anterior ainda está rodando. Pulando este ciclo para evitar sobrecarga...');
      return;
    }
    isRunning = true;
    try {
      const now = new Date().toISOString();

      // ============================================
      // LÓGICA DE AGENDAMENTOS (Agendamentos Unitários)
      // ============================================
      const scheduledSnapshot = await db.collection('scheduled_offers')
        .where('status', '==', 'pending')
        .get();

      console.log(`[scheduler] Agendamentos pendentes no Firestore: ${scheduledSnapshot.size}`);

      if (!scheduledSnapshot.empty) {
        const pendingDocs = scheduledSnapshot.docs.filter(doc => doc.data().scheduledFor <= now);

        // Separa: ofertas no horário exato vs. ofertas atrasadas (mais de 2min de atraso)
        const twoMinutesAgo = new Date(Date.now() - 2 * 60000).toISOString();
        const onTime = pendingDocs.filter(doc => doc.data().scheduledFor > twoMinutesAgo);
        const overdue = pendingDocs
          .filter(doc => doc.data().scheduledFor <= twoMinutesAgo)
          .sort((a, b) => a.data().scheduledFor.localeCompare(b.data().scheduledFor)); // mais antiga primeiro

        // Processa ofertas no horário: todas de uma vez
        const docsToProcess = [...onTime];

        // Processa atrasadas: apenas 1 por vez (intervalo de 1 min = próximo tick do cron)
        if (overdue.length > 0) {
          docsToProcess.push(overdue[0]);
          if (overdue.length > 1) {
            console.log(`⏳ Fila de reenvio: ${overdue.length - 1} pendência(s) atrasada(s) aguardando próximos ciclos.`);
          }
        }

        const MAX_RETRIES = 5;

        for (const doc of docsToProcess) {
          const schedule = doc.data();
          const { userId, messageText, targetChannels } = schedule;
          const retryCount: number = schedule.retryCount || 0;
          let sentCount = 0;

          // Verifica se excedeu o máximo de tentativas
          if (retryCount >= MAX_RETRIES) {
            await doc.ref.update({
              status: 'failed_permanently',
              failedAt: new Date().toISOString(),
              failReason: `Máximo de ${MAX_RETRIES} tentativas atingido sem sucesso.`
            });
            console.warn(`❌ Agendamento ${doc.id} marcado como falha permanente após ${retryCount} tentativas.`);
            continue;
          }

          for (const channel of targetChannels) {
            let channelData: FirebaseFirestore.DocumentData | undefined;
            try {
              // Buscar o canal atualizado no Firestore para pegar o targetId correto e o status atual
              const channelRef = db.doc(`users/${userId}/channels/${channel.id}`);
              const channelSnap = await channelRef.get();
              
              if (!channelSnap.exists) {
                console.warn(`Canal ${channel.name} (${channel.id}) não existe mais.`);
                continue;
              }

              channelData = channelSnap.data();
              if (channelData?.status === 'paused') {
                console.log(`Canal ${channel.name} está pausado, pulando disparo.`);
                continue;
              }

              const channelTargetId = channelData?.targetId || channel.targetId || channel.id;
              await sendMessageHelper(userId, messageText, channel.type || channelData?.type, channelTargetId, schedule.imageUrl);
              
              sentCount++;
              await channelRef.update({ totalSent: (channelData?.totalSent || 0) + 1, lastSent: 'Automático' });
            } catch (e: any) {
              console.error(`Erro ao disparar agendamento ${doc.id} para ${channel.name}:`, e.message || e);
              try {
                const admin = require('firebase-admin');
                const errorItem = {
                  channelId: channel.id || null,
                  channelName: channel.name || null,
                  channelType: channel.type || channelData?.type || 'unknown',
                  errorMessage: e.message || String(e),
                  timestamp: new Date().toISOString()
                };
                await doc.ref.update({
                  errors: admin.firestore.FieldValue.arrayUnion(errorItem)
                });
              } catch (err) {
                console.error('Erro ao salvar log de erro no Firestore:', err);
              }
            }
          }

          try {
            if (sentCount > 0) {
              // Sucesso (total ou parcial) → marca como enviado
              await doc.ref.update({
                status: 'sent',
                sentAt: new Date().toISOString(),
                sentCount
              });
              console.log(`✅ Agendamento ${doc.id} concluído. (${sentCount} disparos)`);
            } else {
              // Falha total → reenfileira para daqui 1 minuto
              const nextRetryAt = new Date(Date.now() + 60000).toISOString();
              const nextRetryCount = retryCount + 1;
              await doc.ref.update({
                scheduledFor: nextRetryAt,
                retryCount: nextRetryCount,
                lastRetryAt: new Date().toISOString()
              });
              console.warn(`⚠️ Agendamento ${doc.id} falhou (tentativa ${nextRetryCount}/${MAX_RETRIES}). Próximo reenvio em 1 minuto: ${nextRetryAt}`);
            }
          } catch (updateErr: any) {
            console.error(`Erro crítico ao atualizar status do agendamento ${doc.id} no Firestore:`, updateErr.message || updateErr);
          }
        }
      }

      // ============================================
      // LÓGICA DE CAMPANHAS (Esteira de Postagem Automática)
      // ============================================
      const campaignsSnapshot = await db.collection('campaigns')
        .where('status', '==', 'active')
        .get();

      console.log(`[scheduler] Campanhas ativas no Firestore: ${campaignsSnapshot.size}`);
      if (!campaignsSnapshot.empty) {
        campaignsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          console.log(`[scheduler] Campanha "${data.name}" (${doc.id}): nextRunAt=${data.nextRunAt}, now=${now}, nextRunAt <= now is: ${data.nextRunAt <= now}`);
        });

        const activeCampaigns = campaignsSnapshot.docs.filter(doc => doc.data().nextRunAt <= now);
        
        for (const doc of activeCampaigns) {
          const campaign = doc.data();
          const { userId, links, targetChannels, currentIndex, intervalMinutes, name } = campaign;
          
          if (currentIndex >= links.length) {
            await doc.ref.update({ status: 'finished' });
            continue;
          }
 
          // Sanitiza o link: se vier com TAB ou espaço duplo (dois links colados), usa só o primeiro URL válido
          const rawLink = links[currentIndex];
          const linkUrl = (rawLink || '').split(/\t|\s{2,}/).map((s: string) => s.trim()).filter((s: string) => s.startsWith('http'))[0] || rawLink;
          console.log(`🚀 Processando link da campanha [${name}]: ${linkUrl}`);

          try {
            let finalUrl = linkUrl;
            let keyword = extractKeywordFromUrl(finalUrl);

            // 1. Resolução do Redirecionamento (Bypass de links curtos) - Qualquer plataforma (Shopee, Amazon, Mercado Livre, etc.)
            if (linkUrl && linkUrl.startsWith('http')) {
              finalUrl = await resolveRedirectPuppeteer(linkUrl);
              keyword = extractKeywordFromUrl(finalUrl);
            }
            
            // Fallback: Se for só texto ou busca, a keyword é o próprio texto.
            if (!keyword && !finalUrl.startsWith('http')) {
              keyword = finalUrl;
            }

            let productTitle = keyword || 'Oferta Especial';
            let productPrice = '';
            let productImageUrl = '';

            // --- CAMADA 1.5: CONSULTA DIRETA POR ITEM ID NA API OFICIAL (Bypassa Playwright se funcionar) ---
              const itemId = extractItemIdFromUrl(finalUrl);
              if (itemId && (finalUrl.includes('shopee') || linkUrl.includes('shopee'))) {
                console.log(`[campanhas] Item ID detectado: ${itemId}. Consultando API Oficial diretamente...`);
                const officialData = await fetchShopeeOfficialApi(itemId);
                if (officialData) {
                  productTitle = officialData.title || productTitle;
                  productPrice = officialData.price || productPrice;
                  productImageUrl = officialData.imageUrl || productImageUrl;
                  console.log(`[campanhas] Sucesso na consulta direta por Item ID! Preço: ${productPrice}`);
                }
              }

              // --- CAMADA 2: API OFICIAL DA SHOPEE (Por Keyword da URL se a por ID falhar) ---
              if (!productPrice && keyword) {
                const officialData = await fetchShopeeOfficialApi(keyword);
                if (officialData) {
                  productTitle = officialData.title || productTitle;
                  productPrice = officialData.price || productPrice;
                  productImageUrl = officialData.imageUrl || productImageUrl;
                }
              }

              // --- CAMADA 3: PLAYWRIGHT FALLBACK ---
              if (!productPrice || !productImageUrl) {
                const scrapedData = await scrapeProductPuppeteer(finalUrl);
                if (scrapedData) {
                  productTitle = scrapedData.title || productTitle;
                  productPrice = scrapedData.price || productPrice;
                  productImageUrl = scrapedData.imageUrl || productImageUrl;
                }
              }

              // --- CAMADA 3.5: API OFICIAL FALLBACK COM O TÍTULO RASPADO (Somente Shopee) ---
              if (!productPrice && productTitle && productTitle !== 'Oferta Especial' && (finalUrl.includes('shopee') || linkUrl.includes('shopee'))) {
                console.log(`[campanhas] Tentando API Oficial com título raspado: "${productTitle}"`);
                const officialData = await fetchShopeeOfficialApi(productTitle);
                if (officialData) {
                  productTitle = officialData.title || productTitle;
                  productPrice = officialData.price || productPrice;
                  productImageUrl = officialData.imageUrl || productImageUrl;
                  console.log(`[campanhas] Sucesso via API Oficial usando título raspado! Preço: ${productPrice}`);
                }
              }

            const imageUrl = productImageUrl || null;

            let platform = 'desconhecida';
            if (linkUrl.includes('amazon') || linkUrl.includes('amzn')) platform = 'amazon';
            else if (linkUrl.includes('shopee') || linkUrl.includes('shp')) platform = 'shopee';
            else if (linkUrl.includes('mercadolivre') || linkUrl.includes('meli')) platform = 'mercadolivre';

            // 3. Montar texto da oferta usando o template
            console.log(`Montando oferta manual para: ${productTitle}`);
            
            const templateText = campaign.template || '🔥 CONFIRA ESTA OFERTA! 🔥\n\n📦 {nome}\n💵 Apenas {preco}\n\n🛒 Compre aqui: {link}';
            let msgContent = templateText
              .replace(/{nome}/g, productTitle || 'Oferta Especial')
              .replace(/{preco}/g, productPrice || 'Confira no site')
              .replace(/{link}/g, linkUrl);

            // 4. Enviar para os canais
            let sentCount = 0;
            for (const channel of targetChannels) {
              
              let channelData: FirebaseFirestore.DocumentData | undefined;
              try {
                // Buscar o canal atualizado no Firestore para pegar o targetId correto e o status atual
                const channelRef = db.doc(`users/${userId}/channels/${channel.id}`);
                const channelSnap = await channelRef.get();
                
                if (!channelSnap.exists) {
                  console.warn(`Canal ${channel.name} (${channel.id}) não existe mais.`);
                  continue;
                }

                channelData = channelSnap.data();
                if (channelData?.status === 'paused') {
                  console.log(`Canal ${channel.name} está pausado, pulando disparo.`);
                  continue;
                }

                const channelTargetId = channelData?.targetId || channel.targetId || channel.id;
                await sendMessageHelper(userId, msgContent, channel.type || channelData?.type, channelTargetId, imageUrl);
                
                sentCount++;
                // Atualiza totalSent
                await channelRef.update({ totalSent: (channelData?.totalSent || 0) + 1, lastSent: 'Automático (Campanha)' });
              } catch (err: any) {
                console.error(`Erro ao enviar esteira para canal (Campanha):`, err.message || err);
                try {
                  const admin = require('firebase-admin');
                  const errorItem = {
                    channelId: channel.id || null,
                    channelName: channel.name || null,
                    channelType: channel.type || channelData?.type || 'unknown',
                    errorMessage: err.message || String(err),
                    timestamp: new Date().toISOString()
                  };
                  await doc.ref.update({
                    errors: admin.firestore.FieldValue.arrayUnion(errorItem)
                  });
                } catch (err2) {
                  console.error('Erro ao salvar log de erro da campanha no Firestore:', err2);
                }
              }
            }
            
            console.log(`✅ Link da campanha processado. Disparado para ${sentCount} canais.`);

            // 7. Update Campaign Status
            const nextIndex = currentIndex + 1;
            const newStatus = nextIndex >= links.length ? 'finished' : 'active';
            const safeInterval = Number(intervalMinutes) || 60;
            const nextRunDate = new Date(Date.now() + safeInterval * 60000).toISOString();

            console.log(`[scheduler] Atualizando campanha ${doc.id} (sucesso) no Firestore: currentIndex=${nextIndex}, status=${newStatus}, nextRunAt=${nextRunDate}`);
            await doc.ref.update({
              currentIndex: nextIndex,
              status: newStatus,
              nextRunAt: nextRunDate
            });
            console.log(`[scheduler] Campanha ${doc.id} atualizada com sucesso no Firestore!`);

          } catch (e: any) {
            console.error(`❌ Erro ao processar link da campanha ${doc.id}:`, e.message);
            // Sempre avança índice e atualiza nextRunAt para não travar a campanha
            const nextIndex = currentIndex + 1;
            const newStatus = nextIndex >= links.length ? 'finished' : 'active';
            const safeInterval = Number(intervalMinutes) || 60;
            const nextRunDate = new Date(Date.now() + safeInterval * 60000).toISOString();
            try {
              console.log(`[scheduler] Atualizando campanha ${doc.id} (erro) no Firestore: currentIndex=${nextIndex}, status=${newStatus}, nextRunAt=${nextRunDate}`);
              await doc.ref.update({
                currentIndex: nextIndex,
                status: newStatus,
                nextRunAt: nextRunDate
              });
              console.log(`[scheduler] Campanha ${doc.id} (erro fallback) atualizada com sucesso no Firestore!`);
            } catch (updateErr: any) {
              console.error(`❌ Erro ao atualizar campanha ${doc.id} após falha:`, updateErr.message);
            }
          }
        }
      }

    } catch (error) {
      console.error('Erro no cron scheduler:', error);
    } finally {
      isRunning = false;
    }
  });
};
