import * as cheerio from 'cheerio';
import crypto from 'crypto';
import fetch from 'node-fetch';

/**
 * Tenta buscar os dados originais usando a Chave Global da Shopee.
 * Se as variáveis de ambiente não estiverem configuradas ou a assinatura falhar, retorna null.
 */
async function fetchFromOfficialShopeeApi(offerLink: string): Promise<{ title?: string, imageUrl?: string, price?: string } | null> {
  const appId = process.env.GLOBAL_SHOPEE_APP_ID;
  const appSecret = process.env.GLOBAL_SHOPEE_APP_SECRET;
  if (!appId || !appSecret) return null;

  try {
    const payloadObj = { "query": `{ productOfferV2(offerLink: "${offerLink}") { nodes { offerName price imageList } } }` };
    const payload = JSON.stringify(payloadObj);
    const timestamp = Math.floor(Date.now() / 1000);
    const factor = appId + timestamp + payload + appSecret;
    const signature = crypto.createHmac('sha256', appSecret).update(factor, 'utf8').digest('hex');

    const res = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`
      },
      body: payload
    });

    const data: any = await res.json();
    if (data && data.data && data.data.productOfferV2 && data.data.productOfferV2.nodes && data.data.productOfferV2.nodes.length > 0) {
      const node = data.data.productOfferV2.nodes[0];
      return {
        title: node.offerName,
        price: node.price ? String(node.price) : undefined,
        imageUrl: node.imageList ? node.imageList[0] : undefined
      };
    }
    return null;
  } catch (error) {
    console.error("Erro na API Oficial da Shopee (Fallback para Telegram ativado):", error);
    return null;
  }
}

export async function resolveShopeeShortlink(shortLink: string) {
  // TENTA A API OFICIAL PRIMEIRO
  const officialData = await fetchFromOfficialShopeeApi(shortLink);
  if (officialData) {
    return { 
      finalUrl: shortLink, 
      pageTitle: officialData.title, 
      imageUrl: officialData.imageUrl,
      price: officialData.price,
      htmlContent: `<html><body><h1>${officialData.title}</h1><div>Preço Original: R$ ${officialData.price}</div></body></html>` 
    };
  }

  // FALLBACK: A ponte do Telegram
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  if (!botToken || !channelId) {
    console.warn('Telegram Bridge não configurada. Faltam chaves.');
    return null;
  }

  try {
    // 1. Enviar mensagem para o canal
    const sendUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channelId,
        text: shortLink
      })
    });
    
    const sendData = (await sendRes.json()) as any;
    if (!sendData.ok) {
      console.error('Erro ao enviar para Telegram:', sendData);
      return null;
    }
    
    const messageId = sendData.result.message_id;

    // 2. Aguardar 6 segundos para o Telegram gerar o preview internamente (alguns links da Shopee demoram mais)
    await new Promise(r => setTimeout(r, 6000));

    // 3. Fazer Web Scraping da página pública do canal
    // O channelId costuma ser @nome_do_canal. Precisamos apenas do "nome_do_canal"
    const channelName = channelId.replace('@', '');
    const publicUrl = `https://t.me/s/${channelName}/${messageId}`;
    
    const pageRes = await fetch(publicUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = await pageRes.text();
    const $ = cheerio.load(html);

    // 4. Extrair os dados da caixinha de preview
    // <a class="tgme_widget_message_link_preview" href="FINAL_URL">
    // <div class="link_preview_image" style="background-image:url('IMAGE_URL')">
    // <div class="link_preview_title">TITLE</div>
    
    const previewBox = $('.tgme_widget_message_link_preview');
    if (previewBox.length === 0) {
      console.warn('Telegram não gerou o preview a tempo ou a estrutura mudou.');
    }

    let finalUrl = previewBox.attr('href') || shortLink;
    let pageTitle = $('.link_preview_title').text() || '';
    let imageUrl = '';
    
    const bgImage = $('.link_preview_image').css('background-image');
    if (bgImage) {
      // url('https://...') -> https://...
      const match = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
      if (match && match[1]) {
        imageUrl = match[1];
      }
    }

    // 5. Apagar a mensagem do canal para não sujar
    fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, message_id: messageId })
    }).catch(() => {});

    // Retorna os dados simulando a estrutura original
    const fakeHtml = `
      <html><head>
        <title>${pageTitle}</title>
        <meta property="og:image" content="${imageUrl}">
        <meta name="description" content="${$('.link_preview_description').text() || ''}">
      </head><body>
        <div id="raw-preview">${previewBox.html()}</div>
      </body></html>
    `;

    return { finalUrl, pageTitle, htmlContent: fakeHtml };

  } catch (error) {
    console.error('Erro na Ponte do Telegram:', error);
    return null;
  }
}
