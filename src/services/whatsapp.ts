import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers, isJidGroup } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import http from 'http';
import https from 'https';
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

function fetchImageBufferWithTimeout(url: string, timeoutMs: number = 8000): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let resolved = false;
    
    // Configura o timeout da requisição
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.error(`[WhatsApp] Timeout de ${timeoutMs}ms ao baixar imagem da URL ${url}`);
        req.destroy();
        resolve(null);
      }
    }, timeoutMs);

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timeoutId);
        resolved = true;
        resolve(null);
        return;
      }
      
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          resolve(Buffer.concat(chunks));
        }
      });
    });
    
    req.on('error', (err) => {
      clearTimeout(timeoutId);
      if (!resolved) {
        resolved = true;
        console.error(`[WhatsApp] Erro ao baixar imagem da URL ${url}:`, err.message || err);
        resolve(null);
      }
    });
  });
}

// Helper para embrulhar qualquer promise em um timeout
const promiseWithTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timeoutId);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
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
      try {
        const base64Data = imageUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`[WhatsApp] Enviando imagem base64 com timeout de 20s para ${jid}...`);
        await promiseWithTimeout(
          session.socket.sendMessage(jid, { image: buffer, caption: message }),
          20000,
          'Timeout de 20s ao enviar imagem base64'
        );
        console.log(`[WhatsApp] Mensagem com imagem base64 enviada com sucesso para ${jid}`);
        return;
      } catch (err: any) {
        console.error('[WhatsApp] Erro ao enviar imagem base64, tentando texto como fallback:', err.message || err);
      }
    } else {
      console.log(`[WhatsApp] Baixando imagem com timeout de 10s: ${imageUrl}`);
      const imageBuffer = await fetchImageBufferWithTimeout(imageUrl, 10000);
      if (imageBuffer) {
        try {
          console.log(`[WhatsApp] Enviando imagem baixada com timeout de 20s para ${jid}...`);
          await promiseWithTimeout(
            session.socket.sendMessage(jid, { image: imageBuffer, caption: message }),
            20000,
            'Timeout de 20s ao enviar imagem baixada'
          );
          console.log(`[WhatsApp] Mensagem com imagem baixada enviada com sucesso para ${jid}`);
          return;
        } catch (err: any) {
          console.error('[WhatsApp] Erro ao enviar imagem baixada, tentando texto como fallback:', err.message || err);
        }
      } else {
        console.warn('[WhatsApp] Falha ao baixar imagem, enviando como texto apenas.');
      }
    }
  }

  // Fallback para texto simples
  try {
    console.log(`[WhatsApp] Enviando texto com timeout de 15s para ${jid}...`);
    await promiseWithTimeout(
      session.socket.sendMessage(jid, { text: message }),
      15000,
      'Timeout de 15s ao enviar mensagem de texto'
    );
    console.log(`[WhatsApp] Mensagem de texto enviada com sucesso para ${jid}`);
  } catch (err: any) {
    console.error(`[WhatsApp] Erro ao enviar mensagem de texto para ${jid}:`, err.message || err);
    throw err; // Repassa o erro para que o scheduler trate e não trave a esteira
  } finally {
    // Adiciona um delay aleatório entre 3s e 6s após QUALQUER tentativa de envio (com ou sem sucesso)
    // para evitar que o WhatsApp/Baileys silenciosamente descarte mensagens enviadas muito rápido
    const delayMs = Math.floor(Math.random() * 3000) + 3000;
    console.log(`[WhatsApp] Aguardando ${delayMs}ms antes do próximo envio...`);
    await new Promise(r => setTimeout(r, delayMs));
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
