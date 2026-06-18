const fetch = require('node-fetch');
const cheerio = require('cheerio');
require('dotenv').config();

async function test() {
  const url = 'https://api.zenrows.com/v1/?apikey=' + process.env.ZENROWS_API_KEY + '&url=' + encodeURIComponent('https://s.shopee.com.br/30lfwOL1ME') + '&js_render=true&antibot=true&device=mobile&wait=15000&premium_proxy=true';
  try {
    const r = await fetch(url);
    const t = await r.text();
    if (t.startsWith('{')) {
      console.log('ZenRows returned JSON:', t);
    } else {
      const $ = cheerio.load(t);
      console.log('Found title:', $('title').text());
      console.log('HTML size:', t.length);
    }
  } catch (e) {
    console.error(e);
  }
}
test();
