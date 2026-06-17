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

export const sendWhatsAppMessage = async (userId: string, targetId: string, message: string, imageUrl?: string) => {
  let session = sessions[userId];
  if (!session || session.status !== 'connected') {
    console.log(`[WhatsApp] Sessão não encontrada na memória para ${userId}, tentando iniciar...`);
    session = await startWhatsAppSession(userId);
    
    let retries = 0;
    while (session.status !== 'connected' && retries < 15) {
      await new Promise(r => setTimeout(r, 1000));
      retries++;
    }

    if (session.status !== 'connected') {
      throw new Error('WhatsApp não pôde ser conectado.');
    }
  }

  // Ensure targetId format is correct (JID)
  const jid = targetId.includes('@') ? targetId : `${targetId}@g.us`;
  
  // Extract link from message to use as sourceUrl
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = message.match(urlRegex);
  const linkUrl = match ? match[0] : '';

  if (imageUrl && linkUrl) {
    try {
      let thumbnailData;
      if (imageUrl.startsWith('data:image')) {
        const base64Data = imageUrl.split(',')[1];
        thumbnailData = Buffer.from(base64Data, 'base64');
      } else {
        // Download image to attach as buffer
        const fetch = require('node-fetch');
        const response = await fetch(imageUrl);
        const arrayBuffer = await response.arrayBuffer();
        thumbnailData = Buffer.from(arrayBuffer);
      }

      await session.socket.sendMessage(jid, {
        text: message,
        contextInfo: {
          externalAdReply: {
            title: "Acessar Oferta",
            body: "Clique aqui para ver mais",
            thumbnail: thumbnailData,
            sourceUrl: linkUrl,
            mediaType: 1, // 1 = image
            renderLargerThumbnail: true // Make it a large banner
          }
        }
      });
      return; // Sucesso
    } catch (err) {
      console.error('[WhatsApp] Erro ao criar Link Preview forçado, usando fallback:', err);
      // Fallback below
    }
  }

  // Fallback antigo caso não tenha link ou dê erro ao baixar a thumb
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

