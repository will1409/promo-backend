const crypto = require('crypto');
const fetch = require('node-fetch');

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
