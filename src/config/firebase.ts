import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Inicialização do Firebase Admin com o ID do projeto
// As credenciais devem ser fornecidas via variável de ambiente GOOGLE_APPLICATION_CREDENTIALS
// ou um arquivo serviceAccountKey.json em produção.
if (!admin.apps.length) {
  const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (serviceAccountStr) {
    try {
      const serviceAccount = JSON.parse(serviceAccountStr);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'pegue-a-promo'
      });
      console.log('Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT');
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT JSON', e);
      admin.initializeApp({ projectId: 'pegue-a-promo', credential: admin.credential.applicationDefault() });
    }
  } else {
    admin.initializeApp({
      projectId: 'pegue-a-promo',
      credential: admin.credential.applicationDefault()
    });
    console.log('Firebase Admin initialized via applicationDefault');
  }
}

export const db = admin.firestore();
export const auth = admin.auth();
