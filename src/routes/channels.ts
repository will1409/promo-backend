import { Router } from 'express';
import { db } from '../config/firebase';

export const channelsRouter = Router();

channelsRouter.post('/send', async (req, res) => {
  const { userId, message, channelType, targetId, imageUrl } = req.body;

  if (!userId || !message || !channelType || !targetId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Load User Integrations
    const userDoc = await db.collection('users').doc(userId).collection('settings').doc('integrations').get();
    const integrations = userDoc.data() || {};

    let result = null;

    // 2. Route by Channel Type
    if (channelType === 'telegram') {
      const token = integrations.telegramBotToken;
      if (!token) {
        return res.status(400).json({ error: 'Telegram Bot Token não configurado nas Integrações.' });
      }

      let tgResponse;
      if (imageUrl) {
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
      result = tgData;

    } else if (channelType === 'whatsapp') {
      const { sendWhatsAppMessage } = require('../services/whatsapp');
      await sendWhatsAppMessage(userId, targetId, message, imageUrl);
      result = 'Mensagem enviada via Baileys';

    } else {
      return res.status(400).json({ error: 'Canal não suportado' });
    }

    res.json({ success: true, result });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});
