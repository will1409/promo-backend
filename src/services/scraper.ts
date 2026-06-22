import crypto from 'crypto';
import fetch from 'node-fetch';
import path from 'path';

// Define a pasta local do Playwright para garantir que o executável seja encontrado no Render
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, '../../ms-playwright');

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

// Configura o Playwright para usar o plugin stealth (mesmo plugin funciona no playwright-extra)
chromium.use(stealth());

/**
 * 1. Tenta resolver redirecionamentos via requisições HTTP normais (super leve e rápido).
 * Se falhar, usa o Playwright como fallback absoluto.
 */
export async function resolveRedirectPuppeteer(shortLink: string): Promise<string> {
  try {
    console.log(`[scraper] Resolvendo redirecionamento HTTP para: ${shortLink}`);
    const res = await fetch(shortLink, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      },
      redirect: 'follow',
      timeout: 10000 // 10 segundos
    });
    
    console.log(`[scraper] Redirecionamento HTTP resolvido com sucesso para: ${res.url}`);
    return res.url;
  } catch (e: any) {
    console.error("[scraper] Erro ao resolver redirecionamento via HTTP fetch:", e.message || e);
    console.log("[scraper] Tentando fallback para Playwright...");
    
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
      
      await page.goto(shortLink, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const finalUrl = page.url();
      return finalUrl;
    } catch (err: any) {
      console.error("[scraper] Falha no fallback do Playwright:", err.message || err);
      return shortLink; // Retorna o original se tudo falhar
    } finally {
      if (browser) await browser.close();
    }
  }
}

/**
 * 2. Faz uma chamada direta à API Oficial de Afiliados da Shopee.
 * Aceita tanto palavras-chave de texto quanto Item IDs numéricos.
 */
export async function fetchShopeeOfficialApi(keyword: string): Promise<{ title: string, price: string, imageUrl: string } | null> {
  const appId = process.env.GLOBAL_SHOPEE_APP_ID || '18396940613';
  const appSecret = process.env.GLOBAL_SHOPEE_APP_SECRET || 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
  if (!appId || !appSecret || !keyword) return null;

  try {
    let cleanKeyword = keyword.replace(/"/g, '').trim();
    cleanKeyword = cleanKeyword.replace(/\.\.\.$/, '').trim();
    if (!cleanKeyword) return null;

    // Se a keyword for puramente numérica (Item ID), faz o filtro correto por itemId na query GraphQL
    const isNumeric = /^\d+$/.test(cleanKeyword);
    const query = isNumeric
      ? `query { productOfferV2(itemId: ${cleanKeyword}, listType: 0, sortType: 1, limit: 1) { nodes { productName price imageUrl } } }`
      : `query { productOfferV2(keyword: "${cleanKeyword}", listType: 0, sortType: 1, limit: 1) { nodes { productName price imageUrl } } }`;

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
      body: payload,
      timeout: 10000 // 10 segundos
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
      let title = '';
      let price = '';
      let imageUrl = '';

      // Caso especial: Páginas de perfil/lista social do Mercado Livre (ex: /social/...)
      const firstPolyCard = document.querySelector('.poly-card');
      if (firstPolyCard) {
        const titleEl = firstPolyCard.querySelector('.poly-component__title');
        if (titleEl && titleEl.textContent) {
          title = titleEl.textContent.trim();
        }

        const imgEl = firstPolyCard.querySelector('img.poly-component__picture') || firstPolyCard.querySelector('img');
        if (imgEl) {
          imageUrl = (imgEl as HTMLImageElement).src || imgEl.getAttribute('src') || '';
        }

        const priceEls = Array.from(firstPolyCard.querySelectorAll('.andes-money-amount'));
        const currentPriceEl = priceEls.length > 1 ? priceEls[1] : priceEls[0];
        if (currentPriceEl && currentPriceEl.textContent) {
          // Remove espaços indesejados de quebras de tags internas
          price = currentPriceEl.textContent.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',');
        }
      }

      // Pega título se ainda estiver vazio
      if (!title) {
        const titleSelectors = [
          '#productTitle', 
          '#title',
          'h1.ui-pdp-title',
          '.ui-pdp-title',
          'h1' // fallback genérico por último
        ];
        for (const sel of titleSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            title = el.textContent.trim();
            break;
          }
        }
      }

      // Tenta pegar o preço se ainda estiver vazio
      if (!price) {
        const priceSelectors = [
          // Shopee selectors
          'div.pqnscR', '.pqnscR', '.PMuAq5', '.pZkvcx', '.G27FPf',
          // Amazon selectors
          'span.a-price span.a-offscreen', '#price_inside_buybox', '#priceblock_ourprice', '#priceblock_dealprice', '.a-price-whole',
          // Mercado Livre selectors
          '.ui-pdp-price__second-line .andes-money-amount__fraction', '.andes-money-amount__fraction', '.price-tag-fraction', '.ui-pdp-price .andes-money-amount',
          // Generic fallback
          '[class*="price"]', '[class*="price-whole"]'
        ];
        for (const sel of priceSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const text = el.textContent.trim();
            // Certifica-se de que é um preço numérico ou formatado
            if (text.includes('R$') || text.includes('$') || /^[0-9.,]+$/.test(text.replace(/\s/g, '').replace('R$', '').replace('$', ''))) {
              price = text;
              break;
            }
          }
        }
      }

      // Pega a imagem principal se ainda estiver vazia
      if (!imageUrl) {
        const imgSelectors = [
          // Amazon selectors (main product images)
          '#landingImage', '#imgBlkFront', '#imgTagWrapperId img', 'img[data-a-dynamic-image]',
          // Mercado Livre selectors (main product images)
          '.ui-pdp-gallery__figure img', 'img.ui-pdp-image', '.ui-pdp-gallery img',
          // Shopee selectors (main product images)
          '.ZkIrt\\+', '.product-image img', 'img[src*="cf.shopee.com.br"]',
          // Generic selectors (tested after specific matches)
          'picture img',
          // Generic fallback domains
          'img[src*="mlstatic.com"]', 'img[src*="amazon.com"]', 'img[src*="media-amazon.com"]'
        ];
        for (const sel of imgSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            let src = '';
            if (el.tagName.toLowerCase() === 'img') {
              src = (el as HTMLImageElement).src || el.getAttribute('src') || '';
              // Amazon specific check for data-a-dynamic-image containing URLs
              const dynamicImg = el.getAttribute('data-a-dynamic-image');
              if (dynamicImg) {
                try {
                  const parsed = JSON.parse(dynamicImg);
                  const urls = Object.keys(parsed);
                  if (urls.length > 0) {
                    src = urls[0];
                  }
                } catch (e) {}
              }
            } else {
              const img = el.querySelector('img');
              if (img) src = img.src || img.getAttribute('src') || '';
            }
            if (src && src.startsWith('http')) {
              imageUrl = src;
              break;
            }
          }
        }
      }

      // Tratamento de limpeza para o preço do Mercado Livre / Amazon (se não tiver R$)
      if (price && !price.includes('R$')) {
        // Se for só número tipo "1.299" ou "1299,00"
        const cleanVal = price.replace(/\s/g, '').replace('$', '');
        if (/^[0-9.,]+$/.test(cleanVal)) {
          price = 'R$ ' + price.trim();
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

export async function fetchPageData(linkUrl: string, integrations: any) {
  return {
    finalUrl: linkUrl,
    pageTitle: 'Oferta',
    htmlContent: '',
    imageUrl: null
  };
}
