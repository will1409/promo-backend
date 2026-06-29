import { fetchShopeeOfficialApi } from './src/services/scraper';

async function test() {
  const link = 'https://s.shopee.com.br/3g1cSwIx60';
  console.log('Testing Shopee API with short link:', link);
  const data = await fetchShopeeOfficialApi(link);
  console.log('API Data:', data);
}

test().catch(console.error);
