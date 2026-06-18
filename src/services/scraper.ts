import crypto from 'crypto';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

/**
 * Tenta expandir o link usando fetch redirect.
 * Importante: A Shopee muitas vezes joga para error_page se for Node.js.
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
 * Requer o nome exato ou parte do nome do produto.
 */
export async function fetchShopeeOfficialApi(keyword: string): Promise<{ title: string, price: string, imageUrl: string } | null> {
  const appId = process.env.GLOBAL_SHOPEE_APP_ID || '18396940613';
  const appSecret = process.env.GLOBAL_SHOPEE_APP_SECRET || 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
  if (!appId || !appSecret || !keyword) return null;

  try {
    const cleanKeyword = keyword.replace(/"/g, '').trim();
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
