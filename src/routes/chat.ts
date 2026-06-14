import { Router } from 'express';
import type { Request, Response } from 'express';
import { chatFlow } from '../genkit';

const router = Router();

// POST /api/chat — Rota para o chatbot
router.post('/', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'O array de mensagens é obrigatório.' });
    }

    // Chama o fluxo do Genkit
    const reply = await chatFlow(messages);

    return res.json({ success: true, text: reply });
  } catch (error: any) {
    console.error('[/api/chat]', error.message);
    return res.status(500).json({ error: 'Erro interno no chatbot.', details: error.message });
  }
});

export default router;
