const { ShopeeAffiliate } = require('shpee');

const shopee = new ShopeeAffiliate({
    appId: '18396940613',
    appSecret: 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3'
});

async function test() {
    try {
        const query = `{ productOfferV2(offerLink: "https://shopee.com.br/Kit-AMD-Ryzen-7-5700X-e-Placa-M%C3%A3e-B550M-Aorus-Elite-Bios-Atualizada-i.380962383.15170327310") { nodes { offerName price } } }`;
        const res = await shopee.post(query);
        console.log("Success:", JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error("Error:", e.response ? e.response.data : e.message);
    }
}

test();
