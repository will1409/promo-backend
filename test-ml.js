const fs = require('fs');
const html = fs.readFileSync('ml-social-full.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
const script = $('#__NORDIC_RENDERING_CTX__').html();
if (script) {
    const jsonStr = script.split('_n.ctx.r=')[1].replace(/;$/, '');
    const data = JSON.parse(jsonStr);
    const polycards = data.appProps.pageProps.data.components.find(c => c.id === 'card-featured').recommendation_data.polycards;
    const item = polycards[0];
    const title = item.components.find(c => c.type === 'title').title.text;
    const price = item.components.find(c => c.type === 'price').price.current_price.value;
    const imageUrl = 'https://http2.mlstatic.com/D_NQ_NP_' + item.pictures.pictures[0].id + '-O.webp';
    console.log({title, price, imageUrl});
}
