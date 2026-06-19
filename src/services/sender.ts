import { db } from '../config/firebase';
import { sendWhatsAppMessage } from './whatsapp';
import crypto from 'crypto';

export async function sendMessageHelper(
  userId: string,
  message: string,
  channelType: string,
  targetId: string,
  imageUrl?: string | null
): Promise<any> {
  // 1. Carrega as integrações do usuário
  const userDoc = await db.collection('users').doc(userId).collection('settings').doc('integrations').get();
  const integrations = userDoc.data() || {};

  if (channelType === 'telegram') {
    const token = integrations.telegramBotToken;
    if (!token) {
      throw new Error('Telegram Bot Token não configurado nas Integrações.');
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
          parse_mode: 'HTML'
        })
      });
    } else {
      tgResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetId,
          text: message,
          parse_mode: 'HTML'
        })
      });
    }

    const tgData: any = await tgResponse.json();
    if (!tgData.ok) {
      throw new Error(tgData.description || 'Erro na API do Telegram');
    }
    return tgData;

  } else if (channelType === 'whatsapp') {
    await sendWhatsAppMessage(userId, targetId, message, imageUrl || undefined);
    return 'Mensagem enviada via Baileys';
  } else {
    throw new Error('Canal não suportado');
  }
}
