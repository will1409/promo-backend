import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { db } from '../config/firebase';

const CACHE_SIZE = 100; // cache to avoid too many reads

export const useFirestoreAuthState = async (userId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
  const collectionRef = db.collection('users').doc(userId).collection('whatsapp_auth');
  const credsRef = collectionRef.doc('creds');
  
  // Local cache for keys
  const keysCache: { [key: string]: any } = {};

  const writeData = async (data: any, docId: string) => {
    try {
      const parsedData = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await collectionRef.doc(docId).set(parsedData);
    } catch (error) {
      console.error(`Error saving auth state for ${docId}:`, error);
    }
  };

  const readData = async (docId: string) => {
    try {
      const snap = await collectionRef.doc(docId).get();
      if (snap.exists) {
        return JSON.parse(JSON.stringify(snap.data()), BufferJSON.reviver);
      }
      return null;
    } catch (error) {
      console.error(`Error reading auth state for ${docId}:`, error);
      return null;
    }
  };

  const removeData = async (docId: string) => {
    try {
      await collectionRef.doc(docId).delete();
    } catch (error) {
      console.error(`Error deleting auth state for ${docId}:`, error);
    }
  };

  const credsData = await readData('creds');
  const creds: AuthenticationCreds = credsData || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [key: string]: any } = {};
          await Promise.all(
            ids.map(async (id) => {
              const sanitizeId = (str: string) => str.replace(/\//g, '_').replace(/\\/g, '_');
              const docId = sanitizeId(`${type}-${id}`);
              let value = keysCache[docId];
              if (!value) {
                value = await readData(docId);
                if (value) {
                  keysCache[docId] = value;
                }
              }
              if (type === 'app-state-sync-key' && value) {
                // value = SignalDataTypeMap[type].deserialize(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          const sanitizeId = (str: string) => str.replace(/\//g, '_').replace(/\\/g, '_');
          for (const category in data) {
            for (const id in data[category as keyof typeof data]) {
              const value = data[category as keyof typeof data]?.[id];
              const docId = sanitizeId(`${category}-${id}`);
              if (value) {
                keysCache[docId] = value;
                tasks.push(writeData(value, docId));
              } else {
                delete keysCache[docId];
                tasks.push(removeData(docId));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => {
      return writeData(creds, 'creds');
    }
  };
};
