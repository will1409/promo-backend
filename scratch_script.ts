import { db } from './src/config/firebase';

async function run() {
  const snapshot = await db.collection('users').get();
  const users: any[] = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    users.push({
      id: doc.id,
      email: data.email || 'N/A',
      name: data.name || 'N/A',
      plan: data.plan || 'Sem plano definido'
    });
  });
  console.log(JSON.stringify(users, null, 2));
  process.exit(0);
}

run();
