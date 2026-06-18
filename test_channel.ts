import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

fetch('https://t.me/s/meubotlinkou').then(r => r.text()).then(html => {
  const $ = cheerio.load(html);
  console.log('Messages:');
  $('.tgme_widget_message_text').each((i, el) => console.log($(el).text()));
});
