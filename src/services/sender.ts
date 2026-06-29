import { db } from '../config/firebase';
import { sendWhatsAppMessage } from './whatsapp';
import { getUserPlan } from '../utils/planLimits';
import crypto from 'crypto';

export async function sendMessageHelper(
  userId: string,
  message: string,
  channelType: string,
  targetId: string,
  imageUrl?: string | null
): Promise<any> {
  // 1. Carrega as integrações do usuário e plano
  const userDoc = await db.collection('users').doc(userId).collection('settings').doc('integrations').get();
  const integrations = userDoc.data() || {};
  const userPlan = await getUserPlan(userId);
  const isPremium = userPlan === 'premium';

  // Extrai o primeiro link da mensagem para criar o botão clicável ou link preview
  const linkRegex = /(https?:\/\/[^\s]+)/;
  const match = message.match(linkRegex);
  const linkUrl = match ? match[0] : null;

  if (channelType === 'telegram') {
    const token = integrations.telegramBotToken;
    if (!token) {
      throw new Error('Telegram Bot Token não configurado nas Integrações.');
    }

    let replyMarkup: any = undefined;
    if (linkUrl) {
      replyMarkup = {
        inline_keyboard: [
          [
            {
              text: '🛒 Compre Aqui',
              url: linkUrl
            }
          ]
        ]
      };
    }

    let tgResponse;
    if (imageUrl && imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('chat_id', targetId);
      formData.append('photo', blob, 'oferta.jpg');
      formData.append('caption', message);
      formData.append('parse_mode', 'HTML');
      if (replyMarkup) {
        formData.append('reply_markup', JSON.stringify(replyMarkup));
      }

      tgResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: formData
      });
    } else if (imageUrl) {
      tgResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetId,
          photo: imageUrl,
          caption: message,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        })
      });
    } else {
      tgResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetId,
          text: message,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        })
      });
    }

    const tgData: any = await tgResponse.json();
    if (!tgData.ok) {
      throw new Error(tgData.description || 'Erro na API do Telegram');
    }
    return tgData;

  } else if (channelType === 'whatsapp') {
    await sendWhatsAppMessage(userId, targetId, message, imageUrl || undefined, isPremium, linkUrl);
    return 'Mensagem enviada via Baileys';
  } else {
    throw new Error('Canal não suportado');
  }
}
