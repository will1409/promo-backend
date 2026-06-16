import { Router } from 'express';
import { startWhatsAppSession, getWhatsAppStatus, logoutWhatsApp } from '../services/whatsapp';

export const whatsappRouter = Router();

whatsappRouter.post('/connect', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    const session = await startWhatsAppSession(userId);
    res.json({ status: session.status, qr: session.qr });
  } catch (error: any) {
    console.error('Error starting WhatsApp', error);
    res.status(500).json({ error: error.message });
  }
});

whatsappRouter.get('/status/:userId', async (req, res) => {
  const { userId } = req.params;
  const status = await getWhatsAppStatus(userId);
  res.json(status);
});

whatsappRouter.get('/groups/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { getWhatsAppGroups } = require('../services/whatsapp');
    const groups = await getWhatsAppGroups(userId);
    res.json(groups);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

whatsappRouter.post('/logout', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    await logoutWhatsApp(userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
