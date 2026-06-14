import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Inicialização do Firebase Admin com o ID do projeto
// As credenciais devem ser fornecidas via variável de ambiente GOOGLE_APPLICATION_CREDENTIALS
// ou um arquivo serviceAccountKey.json em produção.
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'pegue-a-promo', // ID do projeto solicitado (Project Number: 81573437960)
    credential: admin.credential.applicationDefault()
  });
}

export const db = admin.firestore();
export const auth = admin.auth();
