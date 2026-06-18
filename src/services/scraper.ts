import crypto from 'crypto';
import fetch from 'node-fetch';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

// Configura o Playwright para usar o plugin stealth (mesmo plugin funciona no playwright-extra)
chromium.use(stealth());

/**
 * 1. Usa o Playwright para abrir o link curto, aguardar o redirecionamento
 * e extrair a URL final (longa).
 */
export async function resolveRedirectPuppeteer(shortLink: string): Promise<string> {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    await page.goto(shortLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Pega a URL final após todos os redirecionamentos JS
    const finalUrl = page.url();
    return finalUrl;
  } catch (e) {
    console.error("Erro no Playwright ao resolver redirect:", e);
    return shortLink; // Retorna o original se falhar
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * 2. Faz uma chamada direta à API Oficial de Afiliados da Shopee.
 */
export async function fetchShopeeOfficialApi(keyword: string): Promise<{ title: string, price: string, imageUrl: string } | null> {
  const appId = process.env.GLOBAL_SHOPEE_APP_ID || '18396940613';
  const appSecret = process.env.GLOBAL_SHOPEE_APP_SECRET || 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
  if (!appId || !appSecret || !keyword) return null;

  try {
    let cleanKeyword = keyword.replace(/"/g, '').trim();
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
 * 3. Fallback de Segurança: Usa o Playwright para raspar a página final.
 */
export async function scrapeProductPuppeteer(longUrl: string): Promise<{ title: string, price: string, imageUrl: string } | null> {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    await page.goto(longUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Espera elementos base carregarem (ignorando timeout se não achar h1 rápido)
    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});

    // Avalia o DOM para extrair dados
    const productData = await page.evaluate(() => {
      // Pega título
      const titleEl = document.querySelector('h1');
      let title = titleEl ? (titleEl as HTMLElement).innerText : '';

      // Tenta pegar o preço
      let price = '';
      const priceSelectors = [
        'div.pqnscR', '.pqnscR', '.PMuAq5', '.pZkvcx', '.G27FPf', '[class*="price"]'
      ];
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.includes('R$')) {
          price = el.textContent.trim();
          break;
        }
      }

      // Pega a imagem principal
      let imageUrl = '';
      const imgSelectors = [
        'picture img', '.ZkIrt\\+', '.product-image img', 'img[src*="cf.shopee.com.br"]'
      ];
      for (const sel of imgSelectors) {
        const el = document.querySelector(sel);
        if (el && (el as HTMLImageElement).src) {
          imageUrl = (el as HTMLImageElement).src;
          break;
        }
      }

      return { title, price, imageUrl };
    });

    if (productData.title || productData.price) {
      return productData;
    }
    
    return null;
  } catch (e) {
    console.error("Erro no Playwright Scrape:", e);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}
