import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import offersRouter from './routes/offers';
import chatRouter from './routes/chat';
import creativesRouter from './routes/creatives';
import dashboardRouter from './routes/dashboard';
import { channelsRouter } from './routes/channels';
import { whatsappRouter } from './routes/whatsapp';
import campaignsRouter from './routes/campaigns';
import { startScheduler } from './services/scheduler';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Inicia o Scheduler
startScheduler();

// Middlewares
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health Check
app.get('/api/health', (_req, res) => {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let saStatus = 'Not provided';
  if (serviceAccount) {
    try {
      JSON.parse(serviceAccount);
      saStatus = 'Provided and valid JSON';
    } catch (e) {
      saStatus = 'Provided but INVALID JSON';
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  res.json({ 
    status: 'ok', 
    message: 'Pegue a Promo AI API running ✅',
    nodeVersion: process.version,
    firebaseServiceAccount: saStatus,
    geminiKeyProvided: !!geminiKey,
    groqKeyProvided: !!groqKey
  });
});

// Rotas
app.use('/api/offers', offersRouter);
app.use('/api/chat', chatRouter);
app.use('/api/creatives', creativesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/esteiras', campaignsRouter);



app.listen(port, () => {
  console.log(`✅ Server rodando na porta ${port}`);
  console.log(`🔑 OpenAI Key: ${process.env.OPENAI_API_KEY ? 'Configurada ✅' : 'NÃO CONFIGURADA ❌'}`);
});
