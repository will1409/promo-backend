import { db } from './src/config/firebase';

async function checkErrors() {
  console.log("Checking campaigns for errors...");
  const campaigns = await db.collection('campaigns').get();
  campaigns.forEach(doc => {
    const data = doc.data();
    if (data.errors && data.errors.length > 0) {
      console.log(`Campaign ${doc.id} User ${data.userId}:`);
      console.log(JSON.stringify(data.errors, null, 2));
    }
  });

  console.log("Checking scheduled_offers for errors...");
  const scheduled = await db.collection('scheduled_offers').get();
  scheduled.forEach(doc => {
    const data = doc.data();
    if (data.errors && data.errors.length > 0) {
      console.log(`Scheduled ${doc.id} User ${data.userId}:`);
      console.log(JSON.stringify(data.errors, null, 2));
    }
  });
  
  process.exit(0);
}

checkErrors().catch(console.error);
