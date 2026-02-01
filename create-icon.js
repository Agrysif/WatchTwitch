const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'assets', 'logo.svg');
const pngPath = path.join(__dirname, 'assets', 'icon.png');
const icoPath = path.join(__dirname, 'assets', 'icon.ico');

async function createIcon() {
  try {
    // Создаём PNG разных размеров для ICO
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const buffers = [];
    
    for (const size of sizes) {
      const buffer = await sharp(svgPath)
        .resize(size, size)
        .png()
        .toBuffer();
      buffers.push(buffer);
    }
    
    console.log('✓ PNG буферы созданы');
    
    // Создаём ICO файл из буферов
    const ico = await toIco(buffers);
    fs.writeFileSync(icoPath, ico);
    
    console.log('✓ ICO иконка создана: ' + icoPath);
    
    // Создаём основную PNG 256x256
    await sharp(svgPath)
      .resize(256, 256)
      .png()
      .toFile(pngPath);
    
    console.log('✓ PNG иконка создана: ' + pngPath);
    console.log('✓ Готово! Теперь запустите: npm run build:portable');
    
  } catch (error) {
    console.error('Ошибка при создании иконки:', error);
    process.exit(1);
  }
}

createIcon();
