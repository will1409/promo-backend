import { onRequest } from 'firebase-functions/v2/https';
import express from 'express';
import cors from 'cors';
import offersRouter from './routes/offers';
import linksRouter from './routes/links';
import chatRouter from './routes/chat';

const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'https://pegue-a-promo.web.app'],
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'PromoRadar AI API ✅' });
});

app.use('/offers', offersRouter);
app.use('/links', linksRouter);
app.use('/chat', chatRouter);

// Exporta a API HTTP
export const api = onRequest({ region: 'us-central1', cors: true }, app);
