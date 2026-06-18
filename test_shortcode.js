const crypto = require('crypto');
const fetch = require('node-fetch');

async function test() {
  const appId = '18396940613';
  const appSecret = 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
  const query = 'query { productOfferV2(keyword: "30lfwOL1ME", listType: 0, sortType: 1, limit: 1) { nodes { productName price imageUrl } } }';
  const payload = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const factor = appId + timestamp + payload + appSecret;
  const signature = crypto.createHash('sha256').update(factor).digest('hex');

  const res = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`
    },
    body: payload
  });
  console.log(JSON.stringify(await res.json(), null, 2));
}
test();
