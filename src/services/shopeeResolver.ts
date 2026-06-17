import * as cheerio from 'cheerio';

export async function resolveShopeeShortlink(shortLink: string) {
  // A ponte do Telegram funciona assim:
  // 1. Enviamos o link para um canal público via API do Bot
  // 2. O Telegram gera o preview
  // 3. Raspamos a página pública do canal (HTML) para pegar o preview
  
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID; // Ex: @meu_canal_publico

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

    // 2. Aguardar 3 segundos para o Telegram gerar o preview internamente
    await new Promise(r => setTimeout(r, 3000));

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
      </head><body></body></html>
    `;

    return { finalUrl, pageTitle, htmlContent: fakeHtml };

  } catch (error) {
    console.error('Erro na Ponte do Telegram:', error);
    return null;
  }
}
