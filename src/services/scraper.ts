import crypto from 'crypto';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

/**
 * Tenta expandir o link usando fetch redirect.
 */
export async function expandShortlink(url: string): Promise<string> {
  let finalUrl = url;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(finalUrl, { 
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (loc && !loc.includes('error_page')) {
          finalUrl = loc.startsWith('http') ? loc : new URL(loc, finalUrl).toString();
        } else break;
      } else break;
    } catch (e) { break; }
  }
  return finalUrl;
}

/**
 * Faz uma chamada direta à API Oficial de Afiliados da Shopee.
 */
export async function fetchShopeeOfficialApi(keyword: string): Promise<{ title: string, price: string, imageUrl: string } | null> {
  const appId = process.env.GLOBAL_SHOPEE_APP_ID || '18396940613';
  const appSecret = process.env.GLOBAL_SHOPEE_APP_SECRET || 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
  if (!appId || !appSecret || !keyword) return null;

  try {
    let cleanKeyword = keyword.replace(/"/g, '').trim();
    // Remove "..." at the end which Telegram adds to long previews
    cleanKeyword = cleanKeyword.replace(/\.\.\.$/, '').trim();
    
    if (!cleanKeyword) return null;

    const query = `query { productOfferV2(keyword: "${cleanKeyword}", listType: 0, sortType: 1, limit: 1) { nodes { productName price imageUrl } } }`;
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
    if (data?.data?.productOfferV2?.nodes?.length > 0) {
      const node = data.data.productOfferV2.nodes[0];
      return {
        title: node.productName || '',
        price: node.price ? String(node.price) : '',
        imageUrl: node.imageUrl || ''
      };
    }
    return null;
  } catch (error) {
    console.error("Erro na API Oficial da Shopee:", error);
    return null;
  }
}

/**
 * Ponte secreta via Telegram + ZenRows
 * Envia o link para um canal do Telegram, aguarda o Telegram gerar o preview,
 * e então raspa o HTML web do canal usando ZenRows para evitar bloqueio do Cloudflare do Render.
 */
export async function resolveShopeeViaTelegram(shortLink: string): Promise<{ title: string, imageUrl: string } | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '8939917793:AAFk9XdOF74IVwepff7M0dQutCMZvkf-BKo';
  const channelId = '@meubotlinkou';
  const zenRowsKey = process.env.ZENROWS_API_KEY || '159326979daa756382284d9789d23f5557a9a421';

  if (!botToken || !zenRowsKey) return null;

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
      // Espera inicial de 4 segundos pro Telegram gerar o preview
      await new Promise(r => setTimeout(r, 4000));

      const channelName = channelId.replace('@', '');
      const publicUrl = `https://t.me/s/${channelName}/${messageId}`;
      const proxyUrl = `https://api.zenrows.com/v1/?apikey=${zenRowsKey}&url=${encodeURIComponent(publicUrl)}&antibot=true`;

      let title = '';
      let imageUrl = '';

      for (let attempt = 0; attempt < 2; attempt++) {
        const pageRes = await fetch(proxyUrl);
        const html = await pageRes.text();
        const $ = cheerio.load(html);

        title = $('.link_preview_title').text() || '';
        const bgImage = $('.link_preview_image').css('background-image');
        if (bgImage) {
          const match = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
          if (match && match[1]) { imageUrl = match[1]; }
        }

        if (title || imageUrl) break; // Sucesso, sai do loop
        
        // Se falhou, espera mais 4 segundos e tenta de novo
        if (attempt === 0) await new Promise(r => setTimeout(r, 4000));
      }

      // Cleanup invisível
      fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: channelId, message_id: messageId })
      }).catch(() => {});

      if (title || imageUrl) {
        return { title, imageUrl };
      }
    }
  } catch (e) {
    console.error("Erro no Telegram Bridge via ZenRows:", e);
  }
  return null;
}
