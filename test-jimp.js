const Jimp = require('jimp');
async function test() {
  try {
    const fs = require('fs');
    // create a dummy buffer
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const image = await Jimp.read(buf);
    image.resize(1, 1);
    const result = await image.getBufferAsync(Jimp.MIME_JPEG);
    console.log("Success! size:", result.length);
  } catch (e) {
    console.error(e);
  }
}
test();
