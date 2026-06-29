import { fetchShopeeOfficialApi } from './src/services/scraper';
import https from 'https';

async function test() {
  const data = await fetchShopeeOfficialApi("tenis"); // just a random keyword
  if (data && data.imageUrl) {
    console.log("Got image URL:", data.imageUrl);
    
    // Test without UA
    https.get(data.imageUrl, (res) => {
      console.log(`No UA status: ${res.statusCode}`);
      
      // Test with UA
      https.get(data.imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
        console.log(`With UA status: ${res2.statusCode}`);
      });
    });
  } else {
    console.log("No data returned");
  }
}

test().catch(console.error);
