import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import offersRouter from './routes/offers';
import linksRouter from './routes/links';
import chatRouter from './routes/chat';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: ['http://localhost:5173', 'https://pegue-a-promo.web.app'],
  credentials: true,
}));
app.use(express.json());

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Pegue a Promo AI API running ✅' });
});

// Rotas
app.use('/api/offers', offersRouter);
app.use('/api/links', linksRouter);
app.use('/api/chat', chatRouter);

// Rota do Encurtador de Links (Redirecionamento)
app.get('/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
    
    // Ignorar requisições para favicon ou api
    if (shortCode === 'favicon.ico' || shortCode === 'api') return res.status(404).end();

    const { db } = await import('./config/firebase');
    const snapshot = await db.collection('links').where('shortCode', '==', shortCode).limit(1).get();
    
    if (snapshot.empty) {
      return res.redirect('https://pegue-a-promo.web.app'); // Fallback se não encontrar
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    
    // Incrementar cliques em background (não precisa dar await para não atrasar o redirect)
    doc.ref.update({ clicks: (data.clicks || 0) + 1 }).catch(console.error);

    // Redirecionar para o link original
    return res.redirect(data.originalUrl);
  } catch (error) {
    console.error('Erro no redirecionamento:', error);
    return res.redirect('https://pegue-a-promo.web.app');
  }
});

app.listen(port, () => {
  console.log(`✅ Server rodando na porta ${port}`);
  console.log(`🔑 OpenAI Key: ${process.env.OPENAI_API_KEY ? 'Configurada ✅' : 'NÃO CONFIGURADA ❌'}`);
});
