import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import offersRouter from './routes/offers';
import linksRouter from './routes/links';
import chatRouter from './routes/chat';
import creativesRouter from './routes/creatives';
import dashboardRouter from './routes/dashboard';

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
app.use('/api/creatives', creativesRouter);
app.use('/api/dashboard', dashboardRouter);

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
    
    const userAgent = req.get('User-Agent') || '';
    const referer = req.get('Referer') || '';
    
    let source = 'Outros';
    if (userAgent.includes('Instagram') || referer.includes('instagram.com')) source = 'Instagram';
    else if (userAgent.includes('Telegram') || referer.includes('t.me')) source = 'Telegram';
    else if (userAgent.includes('WhatsApp') || referer.includes('whatsapp.com') || userAgent.includes('FBAN/WhatsApp')) source = 'WhatsApp';

    // Incrementar cliques em background
    const updateData: any = { clicks: (data.clicks || 0) + 1 };
    
    const clicksBySource = data.clicksBySource || { Telegram: 0, WhatsApp: 0, Instagram: 0, Outros: 0 };
    clicksBySource[source] = (clicksBySource[source] || 0) + 1;
    updateData.clicksBySource = clicksBySource;

    doc.ref.update(updateData).catch(console.error);

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
