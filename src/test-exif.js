const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BASE = __dirname;

async function main() {
  const img = path.join(BASE, '..', 'public', 'logos', 'sonylogo.jpg');
  const meta = await sharp(img).metadata();
  console.log('Format:', meta.format);
  console.log('Has exif:', !!meta.exif);
  
  if (meta.exif) {
    const exr = require('exif-reader');
    try {
      const parsed = exr(meta.exif);
      console.log('Parsed keys:', Object.keys(parsed));
      console.log('Image:', JSON.stringify(parsed.image));
      console.log('Exif:', JSON.stringify(parsed.exif));
    } catch(e) {
      console.log('exif-reader error:', e.message);
    }
  }
}
main();
