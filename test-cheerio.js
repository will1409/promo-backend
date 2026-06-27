const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://meli.la/2jaCAsd', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
}).then(r => {
  const $ = cheerio.load(r.data);
  console.log('Title:', $('meta[property="og:title"]').attr('content'));
  console.log('Image:', $('meta[property="og:image"]').attr('content'));
  
  const priceContainer = $('.andes-money-amount').first();
  const fraction = priceContainer.find('.andes-money-amount__fraction').text();
  const cents = priceContainer.find('.andes-money-amount__cents').text();
  console.log('Price:', `R$ ${fraction}${cents ? ',' + cents : ''}`);
}).catch(console.error);
