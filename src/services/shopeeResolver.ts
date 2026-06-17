import puppeteer from 'puppeteer';

export async function resolveShopeeShortlink(shortLink: string) {
  let browser;
  try {
    // Configuração extrema de economia de RAM para rodar no Render Free (512MB)
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--js-flags="--max-old-space-size=100"' // Limita memória JS do Chrome
      ]
    });

    const page = await browser.newPage();
    
    // Ocultar navegação fantasma para evitar bloqueios extras da shopee
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9'
    });

    // Bloquear imagens, fontes e CSS para economizar RAM e carregar mais rápido
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navega até o link da shopee e espera o DOM renderizar
    await page.goto(shortLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // A shopee faz um redirecionamento JS, precisamos esperar o URL final e a página carregar
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

    // Aguardar alguns segundos para o React/Vue carregar os dados reais na tela
    await new Promise(r => setTimeout(r, 4000));

    const finalUrl = page.url();
    const pageTitle = await page.title();
    const htmlContent = await page.content();

    return { finalUrl, pageTitle, htmlContent };

  } catch (error) {
    console.error('Erro no shopeeResolver:', error);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
