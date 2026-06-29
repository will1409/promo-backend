import { db } from './src/config/firebase';

async function updatePlan() {
  try {
    const usersSnapshot = await db.collection('users').get();
    let batch = db.batch();
    let count = 0;
    let total = 0;

    for (const doc of usersSnapshot.docs) {
      // Usamos set com merge: true caso o documento exista mas não tenha os campos corretos, 
      // ou update caso tenhamos certeza. Merge: true é mais seguro.
      batch.set(doc.ref, { plan: 'premium' }, { merge: true });
      count++;
      total++;

      if (count === 499) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }

    console.log(`Sucesso: ${total} usuários foram atualizados para o plano premium.`);
  } catch (err) {
    console.error('Error updating plan:', err);
  } finally {
    process.exit(0);
  }
}

updatePlan();
