import * as cheerio from 'cheerio';
import crypto from 'crypto';
import fetch from 'node-fetch';

/**
 * Tenta buscar os dados originais usando a Chave Global da Shopee via pesquisa por nome do produto.
 * Se as variáveis de ambiente não estiverem configuradas ou a busca falhar, retorna null.
 */
async function fetchFromOfficialShopeeApi(keyword: string): Promise<{ title?: string, imageUrl?: string, price?: string } | null> {
  const appId = process.env.GLOBAL_SHOPEE_APP_ID;
  const appSecret = process.env.GLOBAL_SHOPEE_APP_SECRET;
  if (!appId || !appSecret || !keyword) return null;

  try {
    // Usando createHash('sha256') puro conforme a documentação da Shopee Affiliate, NÃO HMAC!
    const query = `query { productOfferV2(keyword: "${keyword.replace(/"/g, '')}", listType: 0, sortType: 1, limit: 1) { nodes { productName price imageUrl } } }`;
    const payloadObj = { query };
    const payload = JSON.stringify(payloadObj);
    const timestamp = Math.floor(Date.now() / 1000);
    const factor = appId + timestamp + payload + appSecret;
    const signature = crypto.createHash('sha256').update(factor).digest('hex');

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
        title: node.productName,
        price: node.price ? String(node.price) : undefined,
        imageUrl: node.imageUrl ? node.imageUrl : undefined
      };
    }
    return null;
  } catch (error) {
    console.error("Erro na API Oficial da Shopee:", error);
    return null;
  }
}

export async function resolveShopeeShortlink(shortLink: string) {
  // 1. Tenta pegar o Título básico usando a Ponte do Telegram (Fallback super rápido)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  let finalUrl = shortLink;
  let pageTitle = '';
  let telegramImageUrl = '';
  let htmlContent = '';

  if (botToken && channelId) {
    try {
      const sendUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const sendRes = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: channelId, text: shortLink })
      });
      
      const sendData = (await sendRes.json()) as any;
      if (sendData.ok) {
        const messageId = sendData.result.message_id;
        await new Promise(r => setTimeout(r, 6000));

        const channelName = channelId.replace('@', '');
        const publicUrl = `https://t.me/s/${channelName}/${messageId}`;
        
        const pageRes = await fetch(publicUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await pageRes.text();
        const $ = cheerio.load(html);

        const previewBox = $('.tgme_widget_message_link_preview');
        finalUrl = previewBox.attr('href') || shortLink;
        pageTitle = $('.link_preview_title').text() || '';
        
        const bgImage = $('.link_preview_image').css('background-image');
        if (bgImage) {
          const match = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
          if (match && match[1]) { telegramImageUrl = match[1]; }
        }

        fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: channelId, message_id: messageId })
        }).catch(() => {});
        
        htmlContent = previewBox.html() || '';
      }
    } catch (error) {
      console.error('Erro na Ponte do Telegram:', error);
    }
  }

  // 2. Agora que temos o Título, buscamos na API Oficial da Shopee o Preço e Imagem em Alta Resolução!
  let finalImageUrl = telegramImageUrl;
  let officialPrice = '';
  
  if (pageTitle) {
    const officialData = await fetchFromOfficialShopeeApi(pageTitle);
    if (officialData) {
      pageTitle = officialData.title || pageTitle;
      finalImageUrl = officialData.imageUrl || telegramImageUrl;
      officialPrice = officialData.price || '';
    }
  }

  // Montamos o HTML Falso injetando o Preço Oficial para a IA ler perfeitamente!
  const fakeHtml = `
    <html><head>
      <title>${pageTitle}</title>
      <meta property="og:image" content="${finalImageUrl}">
    </head><body>
      <h1>${pageTitle}</h1>
      ${officialPrice ? `<div>Preço Original: R$ ${officialPrice}</div>` : ''}
      <div id="raw-preview">${htmlContent}</div>
    </body></html>
  `;

  return { finalUrl, pageTitle, imageUrl: finalImageUrl, price: officialPrice, htmlContent: fakeHtml };
}

export async function extractDataFromHtml(html: string, link: string) {
  // Apenas extrai os dados do HTML simulado que resolveShopeeShortlink gerou
  const $ = cheerio.load(html);
  let title = $('title').text() || $('h1').text();
  let imageUrl = $('meta[property="og:image"]').attr('content') || '';
  let description = $('meta[name="description"]').attr('content') || '';
  
  return { title, imageUrl, description, fakeHtml: html };
}
