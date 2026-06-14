import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import offersRouter from './routes/offers';
import chatRouter from './routes/chat';
import creativesRouter from './routes/creatives';
import dashboardRouter from './routes/dashboard';
import { channelsRouter } from './routes/channels';

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
app.use('/api/chat', chatRouter);
app.use('/api/creatives', creativesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/channels', channelsRouter);



app.listen(port, () => {
  console.log(`✅ Server rodando na porta ${port}`);
  console.log(`🔑 OpenAI Key: ${process.env.OPENAI_API_KEY ? 'Configurada ✅' : 'NÃO CONFIGURADA ❌'}`);
});
