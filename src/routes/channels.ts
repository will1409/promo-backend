import { Router } from 'express';
import { sendMessageHelper } from '../services/sender';
import { db } from '../config/firebase';
import { getUserLimits } from '../utils/planLimits';

export const channelsRouter = Router();

channelsRouter.post('/send', async (req, res) => {
  const { userId, message, channelType, targetId, imageUrl } = req.body;

  if (!userId || !message || !channelType || !targetId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    let resolvedTargetId = targetId;

    // Se o targetId passado for na verdade o ID de documento do Firestore do canal, resolvemos para o targetId real
    try {
      const channelSnap = await db.doc(`users/${userId}/channels/${targetId}`).get();
      if (channelSnap.exists) {
        const cData = channelSnap.data();
        if (cData?.targetId) {
          resolvedTargetId = cData.targetId;
        }
      }
    } catch (err) {
      console.warn('Erro ao tentar resolver targetId do Firestore, usando o original:', err);
    }

    const result = await sendMessageHelper(userId, message, channelType, resolvedTargetId, imageUrl);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

channelsRouter.post('/create', async (req, res) => {
  const { userId, name, type, targetId } = req.body;

  if (!userId || !name || !type || !targetId) {
    return res.status(400).json({ error: 'Faltam campos obrigatórios' });
  }

  try {
    const limits = await getUserLimits(userId);
    
    // Contar canais atuais do mesmo tipo
    const channelsSnap = await db.collection(`users/${userId}/channels`).where('type', '==', type).get();
    const currentChannelsCount = channelsSnap.size;

    if (currentChannelsCount >= limits.channels) {
      const typeName = type === 'whatsapp' ? 'WhatsApp' : 'Telegram';
      return res.status(403).json({ error: `Você atingiu o limite de ${limits.channels} grupo(s) de ${typeName} do seu plano. Faça upgrade para adicionar mais.` });
    }

    const newDocRef = await db.collection(`users/${userId}/channels`).add({
      name,
      type,
      targetId,
      createdAt: new Date().toISOString()
    });

    return res.json({ success: true, id: newDocRef.id });
  } catch (error: any) {
    console.error('Error creating channel:', error);
    return res.status(500).json({ error: 'Erro ao criar canal.' });
  }
});
