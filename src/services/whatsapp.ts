import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers, isJidGroup } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import pino from 'pino';
import { useFirestoreAuthState } from './whatsappAdapter';

interface WhatsAppSession {
  socket: ReturnType<typeof makeWASocket>;
  qr: string | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'qr';
}

const sessions: { [userId: string]: WhatsAppSession } = {};
const logger = pino({ level: 'silent' });
export const connectionLogs: string[] = [];

export const startWhatsAppSession = async (userId: string) => {
  if (sessions[userId] && sessions[userId].status === 'connected') {
    return sessions[userId];
  }

  console.log(`Starting WhatsApp session for user ${userId}`);
  
  const { state, saveCreds } = await useFirestoreAuthState(userId);

  const socket = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
  });

  sessions[userId] = {
    socket,
    qr: null,
    status: 'connecting'
  };

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    const err = lastDisconnect?.error;
    const logMsg = `[${new Date().toISOString()}] User ${userId}: connection=${connection || 'none'}, status=${sessions[userId]?.status || 'none'}, error=${err ? (err.message || String(err)) : 'none'}`;
    connectionLogs.push(logMsg);
    if (connectionLogs.length > 50) connectionLogs.shift();

    if (qr) {
      try {
        const qrBase64 = await QRCode.toDataURL(qr);
        sessions[userId].qr = qrBase64;
        sessions[userId].status = 'qr';
      } catch (e) {
        console.error('Error generating QR code base64', e);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      sessions[userId].status = 'disconnected';
      sessions[userId].qr = null;
      
      console.log(`Connection closed for user ${userId}. Reconnect: ${shouldReconnect}`);
      
      if (shouldReconnect) {
        setTimeout(() => startWhatsAppSession(userId), 5000);
      } else {
        delete sessions[userId];
      }
    } else if (connection === 'open') {
      console.log(`WhatsApp connected for user ${userId}`);
      sessions[userId].status = 'connected';
      sessions[userId].qr = null;
    }
  });

  socket.ev.on('creds.update', saveCreds);

  return sessions[userId];
};

import { db } from '../config/firebase';

export const getWhatsAppStatus = async (userId: string) => {
  const session = sessions[userId];
  if (!session) {
    try {
      const credsSnap = await db.collection('users').doc(userId).collection('whatsapp_auth').doc('creds').get();
      if (credsSnap.exists) {
        // Start session in background
        startWhatsAppSession(userId).catch(e => console.error('Failed to auto-start WA session', e));
        return { status: 'connecting', qr: null };
      }
    } catch (e) {
      console.error('Error checking WA creds', e);
    }
    return { status: 'disconnected', qr: null };
  }
  return { status: session.status, qr: session.qr };
};

export const logoutWhatsApp = async (userId: string) => {
  const session = sessions[userId];
  if (session) {
    await session.socket.logout();
    delete sessions[userId];
  }
};

/**
 * Força reset completo da sessão (destrói socket atual e recria do zero).
 * Usado quando a sessão fica presa em 'connecting' por muito tempo.
 */
const forceResetSession = async (userId: string): Promise<void> => {
  console.log(`[WhatsApp] Forçando reset de sessão travada para ${userId}...`);
  try {
    const old = sessions[userId];
    if (old) {
      try { old.socket.end(new Error('force-reset')); } catch (_) {}
    }
    delete sessions[userId];
  } catch (e) {
    console.error(`[WhatsApp] Erro ao destruir socket antigo para ${userId}:`, e);
  }
  await startWhatsAppSession(userId);
};

export const sendWhatsAppMessage = async (userId: string, targetId: string, message: string, imageUrl?: string) => {
  // Garante que a sessão existe e não está desconectada
  if (!sessions[userId] || sessions[userId].status === 'disconnected') {
    console.log(`[WhatsApp] Sessão ausente/desconectada para ${userId}, iniciando...`);
    await startWhatsAppSession(userId);
  }

  // Aguarda a conexão — com detecção de sessão travada em 'connecting'
  if ((sessions[userId] as WhatsAppSession).status !== 'connected') {
    console.log(`[WhatsApp] Aguardando conexão para ${userId} (status: ${sessions[userId]?.status})...`);
    
    let retries = 0;
    const MAX_WAIT = 30; // segundos totais
    const FORCE_RESET_AT = 20; // se ainda 'connecting' após 20s, força reset

    while ((sessions[userId] as WhatsAppSession).status !== 'connected' && retries < MAX_WAIT) {
      // Se ficou 20s em 'connecting' sem chegar em 'open', o socket travou — força reset
      if (retries === FORCE_RESET_AT && (sessions[userId] as WhatsAppSession).status === 'connecting') {
        console.log(`[WhatsApp] Sessão travada em 'connecting' para ${userId}. Forçando reset...`);
        await forceResetSession(userId);
      }
      await new Promise(r => setTimeout(r, 1000));
      retries++;
    }

    if ((sessions[userId] as WhatsAppSession).status !== 'connected') {
      throw new Error(`WhatsApp não pôde ser conectado para o usuário ${userId}. Status final: ${sessions[userId]?.status}`);
    }
  }

  const session = sessions[userId];

  // Garante formato JID correto
  const jid = targetId.includes('@') ? targetId : `${targetId}@g.us`;
  
  if (imageUrl) {
    if (imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      await session.socket.sendMessage(jid, { image: buffer, caption: message });
    } else {
      await session.socket.sendMessage(jid, { image: { url: imageUrl }, caption: message });
    }
  } else {
    await session.socket.sendMessage(jid, { text: message });
  }
};

export const getWhatsAppGroups = async (userId: string) => {
  const session = sessions[userId];
  if (!session || session.status !== 'connected') {
    return [];
  }
  try {
    const groups = await session.socket.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject
    }));
  } catch (e) {
    console.error('Error fetching WA groups', e);
    return [];
  }
};

/**
 * Pré-carrega sessões WhatsApp de todos os usuários com credenciais salvas.
 * Chamado ao iniciar o servidor para evitar cold-start no primeiro envio.
 */
export const autoReconnectAllSessions = async (): Promise<void> => {
  try {
    console.log('[WhatsApp] Verificando sessões ativas para auto-reconexão...');
    const usersSnap = await db.collection('users').get();
    let count = 0;
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      try {
        const credsSnap = await db.collection('users').doc(userId).collection('whatsapp_auth').doc('creds').get();
        if (credsSnap.exists) {
          console.log(`[WhatsApp] Auto-iniciando sessão para userId: ${userId}`);
          startWhatsAppSession(userId).catch(e => console.error(`[WhatsApp] Falha ao auto-iniciar sessão para ${userId}:`, e));
          count++;
        }
      } catch (e) {
        // Ignora erros por usuário individual
      }
    }
    console.log(`[WhatsApp] Auto-reconexão iniciada para ${count} usuário(s).`);
  } catch (e) {
    console.error('[WhatsApp] Erro no autoReconnectAllSessions:', e);
  }
};
