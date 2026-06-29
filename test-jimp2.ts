import { Jimp, JimpMime } from 'jimp';

async function test() {
  try {
    const fs = require('fs');
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const image = await Jimp.read(buf);
    image.resize({ w: 1 });
    const result = await image.getBuffer(JimpMime.jpeg);
    console.log("Success! size:", result.length);
  } catch (e) {
    console.error(e);
  }
}
test();
