import { Router } from 'express';
import { sendMessageHelper } from '../services/sender';

export const channelsRouter = Router();

channelsRouter.post('/send', async (req, res) => {
  const { userId, message, channelType, targetId, imageUrl } = req.body;

  if (!userId || !message || !channelType || !targetId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await sendMessageHelper(userId, message, channelType, targetId, imageUrl);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});
