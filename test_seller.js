const crypto = require('crypto');
const fetch = require('node-fetch');

const partner_id = '18396940613';
const partner_key = 'AFCPGMWPPRO7YXODKDHHLJDVKBU3LTJ3';
const path = '/api/v2/product/get_item_base_info';
const timestamp = Math.floor(Date.now()/1000);

const sign = crypto.createHmac('sha256', partner_key).update(partner_id + path + timestamp).digest('hex');

fetch(`https://partner.shopeemobile.com${path}?partner_id=${partner_id}&timestamp=${timestamp}&sign=${sign}&item_id_list=15170327310`)
    .then((r: any) => r.json())
    .then(console.log);
