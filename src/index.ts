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
  res.json({ status: 'ok', message: 'PromoRadar AI API running ✅' });
});

// Rotas
app.use('/api/offers', offersRouter);
app.use('/api/links', linksRouter);
app.use('/api/chat', chatRouter);

app.listen(port, () => {
  console.log(`✅ Server rodando na porta ${port}`);
  console.log(`🔑 OpenAI Key: ${process.env.OPENAI_API_KEY ? 'Configurada ✅' : 'NÃO CONFIGURADA ❌'}`);
});
