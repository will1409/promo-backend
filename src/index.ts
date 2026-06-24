process.env.GRPC_DNS_RESOLVER = 'native';

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Buffer global para logs em memória para debug em produção
export const systemLogs: string[] = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  systemLogs.push(`[${new Date().toISOString()}] [LOG] ${msg}`);
  if (systemLogs.length > 1000) systemLogs.shift();
  originalLog(...args);
};

console.warn = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  systemLogs.push(`[${new Date().toISOString()}] [WARN] ${msg}`);
  if (systemLogs.length > 1000) systemLogs.shift();
  originalWarn(...args);
};

console.error = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  systemLogs.push(`[${new Date().toISOString()}] [ERROR] ${msg}`);
  if (systemLogs.length > 1000) systemLogs.shift();
  originalError(...args);
};

import offersRouter from './routes/offers';
import chatRouter from './routes/chat';
import creativesRouter from './routes/creatives';
import dashboardRouter from './routes/dashboard';
import { channelsRouter } from './routes/channels';
import { whatsappRouter } from './routes/whatsapp';
import campaignsRouter from './routes/campaigns';
import { startScheduler } from './services/scheduler';
import { autoReconnectAllSessions } from './services/whatsapp';
import adminRouter from './routes/admin';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Inicia o Scheduler
startScheduler();

// Pré-carrega sessões WhatsApp de todos os usuários com credenciais salvas
// (evita cold-start: sessão travada em 'connecting' no primeiro envio do cron)
setTimeout(() => {
  autoReconnectAllSessions().catch(e => console.error('[WhatsApp] Erro no auto-reconnect inicial:', e));
}, 5000); // aguarda 5s para o Firestore estar pronto

// Middlewares
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health Check
app.get('/api/health', async (req, res) => {
  // Check Firebase Admin DB
  const { db } = require('./config/firebase');
  let dbStatus = 'Not tested';
  try {
    const snap = await db.collection('system_config').doc('health').get();
    dbStatus = snap.exists ? 'Connected' : 'Connected (doc missing)';
  } catch (err: any) {
    dbStatus = `Error: ${err.message || err}`;
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    firebaseProvided: !!process.env.FIREBASE_PROJECT_ID,
    firebaseStatus: dbStatus,
  });
});

app.get('/api/health/schedules', async (_req, res) => {
  try {
    const { db } = require('./config/firebase');
    const snapshot = await db.collection('scheduled_offers').orderBy('createdAt', 'desc').limit(20).get();
    const list = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));
    res.json({ success: true, list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health/diagnose-wa', async (_req, res) => {
  try {
    const { db } = require('./config/firebase');
    const snapshot = await db.collection('scheduled_offers').orderBy('createdAt', 'desc').limit(5).get();
    const offers = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    const results = [];
    const { getWhatsAppStatus } = require('./services/whatsapp');

    for (const offer of offers) {
      const userId = offer.userId;
      if (!userId) continue;

      const status = await getWhatsAppStatus(userId);
      const credsSnap = await db.collection('users').doc(userId).collection('whatsapp_auth').doc('creds').get();
      const hasCreds = credsSnap.exists;

      results.push({
        offerId: offer.id,
        userId: userId,
        status: offer.status,
        scheduledFor: offer.scheduledFor,
        targetChannels: offer.targetChannels,
        whatsappStatus: status,
        hasCredsInDb: hasCreds
      });
    }

    res.json({ success: true, count: results.length, data: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health/whatsapp-logs', (_req, res) => {
  try {
    const { connectionLogs } = require('./services/whatsapp');
    res.json({ success: true, logs: connectionLogs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = systemLogs.slice(-limit);
    res.json({ success: true, logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rotas
app.use('/api/offers', offersRouter);
app.use('/api/chat', chatRouter);
app.use('/api/creatives', creativesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/esteiras', campaignsRouter);
app.use('/api/admin', adminRouter);



app.listen(port, () => {
  console.log(`✅ Server rodando na porta ${port}`);
  console.log(`🔑 OpenAI Key: ${process.env.OPENAI_API_KEY ? 'Configurada ✅' : 'NÃO CONFIGURADA ❌'}`);
});
