import cron from 'node-cron';
import { db } from '../config/firebase';
import { resolveRedirectPuppeteer, fetchShopeeOfficialApi, scrapeProductPuppeteer } from './scraper';
import { generateCreativeFlow, generateOfferFlow } from '../genkit';
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
  
  // Roda a cada 1 minuto
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date().toISOString();

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
              // Buscar o canal atualizado no Firestore para pegar o targetId correto e o status atual
              const channelRef = db.doc(`users/${userId}/channels/${channel.id}`);
              const channelSnap = await channelRef.get();
              
              if (!channelSnap.exists) {
                console.warn(`Canal ${channel.name} (${channel.id}) não existe mais.`);
                continue;
              }

              const channelData = channelSnap.data();
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

            // --- CAMADA 1: CACHE NO FIREBASE ---
            const cacheKey = keyword ? keyword.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100) : null;
            let productTitle = keyword || 'Oferta Especial';
            let productPrice = '';
            let productImageUrl = '';
            let cacheHit = false;

            if (cacheKey) {
              try {
                const cacheDoc = await db.collection('productsCache').doc(cacheKey).get();
                if (cacheDoc.exists) {
                  const cachedData = cacheDoc.data();
                  // Verifica se o cache é de hoje (menos de 24h)
                  const cacheAgeHours = (Date.now() - (cachedData?.timestamp || 0)) / (1000 * 60 * 60);
                  if (cacheAgeHours < 24) {
                    console.log('📦 Retornado do Cache do Firebase para Campanha:', cacheKey);
                    productTitle = cachedData?.productName || productTitle;
                    productPrice = cachedData?.price || '';
                    productImageUrl = cachedData?.imageUrl || '';
                    cacheHit = true;
                  }
                }
              } catch (err) {
                console.error('Erro ao ler cache do Firebase:', err);
              }
            }

            if (!cacheHit) {
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

              // --- CAMADA 4: SALVAR NO CACHE ---
              if (cacheKey && productPrice && productImageUrl) {
                try {
                  await db.collection('productsCache').doc(cacheKey).set({
                    productName: productTitle,
                    price: productPrice,
                    imageUrl: productImageUrl,
                    timestamp: Date.now()
                  });
                } catch (err) {
                  console.error('Erro ao salvar no cache do Firebase:', err);
                }
              }
            }

            const imageUrl = productImageUrl || null;

            let platform = 'desconhecida';
            if (linkUrl.includes('amazon') || linkUrl.includes('amzn')) platform = 'amazon';
            else if (linkUrl.includes('shopee') || linkUrl.includes('shp')) platform = 'shopee';
            else if (linkUrl.includes('mercadolivre') || linkUrl.includes('meli')) platform = 'mercadolivre';

            // 3. Gerar textos de oferta usando IA
            console.log(`Gerando IA para: ${productTitle}`);
            const aiOffer = await generateOfferFlow({
              productName: productTitle,
              currentPrice: productPrice || 'Confira no site',
              oldPrice: '',
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
                // Buscar o canal atualizado no Firestore para pegar o targetId correto e o status atual
                const channelRef = db.doc(`users/${userId}/channels/${channel.id}`);
                const channelSnap = await channelRef.get();
                
                if (!channelSnap.exists) {
                  console.warn(`Canal ${channel.name} (${channel.id}) não existe mais.`);
                  continue;
                }

                const channelData = channelSnap.data();
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
            const safeInterval = Number(intervalMinutes) || 60;
            const nextRunDate = new Date(Date.now() + safeInterval * 60000).toISOString();
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
