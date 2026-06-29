import fetch from 'node-fetch';
import crypto from 'crypto';

async function testApi() {
  const appId = '18396940613';
  const appSecret = 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
  const cleanKeyword = 'https://s.shopee.com.br/3g1cSwIx60';
  
  const query = `query { productOfferV2(keyword: "${cleanKeyword}", listType: 0, sortType: 1, limit: 1) { nodes { productName price imageUrl } } }`;

  const payloadObj = { query };
  const payload = JSON.stringify(payloadObj);
  const timestamp = Math.floor(Date.now() / 1000);
  const factor = appId + timestamp + payload + appSecret;
  const signature = crypto.createHash('sha256').update(factor).digest('hex');

  console.log("Requesting...");
  const res = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`
    },
    body: payload,
    timeout: 10000
  });

  const data = await res.text();
  console.log("Raw Response:", data);
}

testApi().catch(console.error);
