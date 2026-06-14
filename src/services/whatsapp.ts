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

export const getWhatsAppStatus = (userId: string) => {
  const session = sessions[userId];
  if (!session) return { status: 'disconnected', qr: null };
  return { status: session.status, qr: session.qr };
};

export const logoutWhatsApp = async (userId: string) => {
  const session = sessions[userId];
  if (session) {
    await session.socket.logout();
    delete sessions[userId];
  }
};

export const sendWhatsAppMessage = async (userId: string, targetId: string, message: string) => {
  const session = sessions[userId];
  if (!session || session.status !== 'connected') {
    throw new Error('WhatsApp não está conectado.');
  }

  // Ensure targetId format is correct (JID)
  const jid = targetId.includes('@') ? targetId : `${targetId}@g.us`;
  
  await session.socket.sendMessage(jid, { text: message });
};
