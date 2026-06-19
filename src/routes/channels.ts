import { Router } from 'express';
import { sendMessageHelper } from '../services/sender';
import { db } from '../config/firebase';

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
