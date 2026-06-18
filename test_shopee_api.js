const crypto = require('crypto');
const fetch = require('node-fetch');

const APP_ID = '18396940613';
const APP_SECRET = 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

async function testShopee() {
    const query = 'query { productOfferV2(offerLink: "https://shopee.com.br/product/380962383/15170327310") { nodes { offerName } } }';
    const payload = JSON.stringify({ query });
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Some implementations suggest AppID + Timestamp + Payload + Secret
    // Let's also try AppID + Secret + Payload + Timestamp if first fails
    
    const factor = APP_ID + timestamp + payload + APP_SECRET;
    const signature = crypto.createHmac('sha256', APP_SECRET).update(factor, 'utf8').digest('hex');

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `SHA256 Credential=${APP_ID},Timestamp=${timestamp},Signature=${signature}`
            },
            body: payload
        });
        const data = await res.json();
        console.log("Shopee API Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}
testShopee();
