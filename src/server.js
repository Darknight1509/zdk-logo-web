// ====== ZDK Logo 水印服务 ======
// 服务端：生成底部水印层（文字+Logo合成），原图不动（保留HDR gainmap）
// 完全匹配 zdklogoprj Android 像素级逻辑

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const LOGOS_DIR = path.join(PUBLIC_DIR, 'logos');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const OUTPUT_DIR = path.join(PUBLIC_DIR, 'output');

[PUBLIC_DIR, LOGOS_DIR, UPLOADS_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('不支持的文件格式'));
  }
});

// CORS 头（前端 Canvas 需要 crossOrigin 加载静态图片）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// ====== Logo 列表 ======
app.get('/api/logos', (req, res) => {
  try {
    const files = fs.readdirSync(LOGOS_DIR);
    const logos = files
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map(f => ({
        filename: f,
        name: f.replace(/\.(png|jpg|jpeg)$/i, ''),
        size: fs.statSync(path.join(LOGOS_DIR, f)).size
      }));
    res.json({ logos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== EXIF 提取接口 ======
app.post('/api/exif', upload.single('photo'), async (req, res) => {
  let uploadedFile = req.file;
  try {
    if (!uploadedFile) return res.status(400).json({ error: '请上传图片' });

    // 清理旧文件（上传目录 & 输出目录）
    try {
      const oldUploads = fs.readdirSync(UPLOADS_DIR).filter(f => f !== uploadedFile.filename);
      oldUploads.forEach(f => { try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch {} });
      const oldOutputs = fs.readdirSync(OUTPUT_DIR);
      oldOutputs.forEach(f => { try { fs.unlinkSync(path.join(OUTPUT_DIR, f)); } catch {} });
    } catch (e) { /* cleanup is best-effort */ }

    console.log('[EXIF] 收到文件:', uploadedFile.originalname, uploadedFile.size, '保存到:', uploadedFile.path);
    const t0 = Date.now();

    const metadata = await sharp(uploadedFile.path).metadata();
    console.log('[EXIF] sharp.metadata 耗时:', Date.now() - t0, 'ms');
    const t1 = Date.now();

    const exifData = {};

    if (metadata.exif) {
      const exifParser = require('exif-reader');
      let parsed;
      try {
        parsed = exifParser(metadata.exif);
      } catch (e) {
        console.log('[EXIF] exif-reader 解析失败:', e.message);
        parsed = {};
      }
      console.log('[EXIF] exif-reader 耗时:', Date.now() - t1, 'ms');

      const img = parsed.Image || {};
      const photo = parsed.Photo || {};

      exifData.model = img.Model || '';
      exifData.make = img.Make || '';
      exifData.lensModel = photo.LensModel || '';

      let dt = photo.DateTimeOriginal || '';
      if (dt instanceof Date) {
        // exif-reader 把 EXIF 本地时间存成 UTC，必须用 getUTC* 解回原始值
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        const hh = String(dt.getUTCHours()).padStart(2, '0');
        const mm = String(dt.getUTCMinutes()).padStart(2, '0');
        const ss = String(dt.getUTCSeconds()).padStart(2, '0');
        exifData.dateTimeStr = `${y}.${m}.${d} ${hh}:${mm}:${ss}`;
      } else {
        exifData.dateTimeStr = String(dt).replace(/[:-]/g, '.').replace(/^(\d{4})[:-](\d{2})[:-](\d{2})/, '$1.$2.$3');
      }

      let focalLen = '';
      if (photo.FocalLength) {
        const fl = typeof photo.FocalLength === 'number' ? photo.FocalLength : (photo.FocalLength.numerator / photo.FocalLength.denominator);
        focalLen = Number.isInteger(fl) ? String(Math.round(fl)) : fl.toFixed(1);
      }
      if (photo.FocalLengthIn35mmFilm && img.Model !== 'GFX100S') {
        focalLen = String(photo.FocalLengthIn35mmFilm);
      }

      let fNumber = '';
      if (photo.FNumber) {
        const fn = typeof photo.FNumber === 'number' ? photo.FNumber : (photo.FNumber.numerator / photo.FNumber.denominator);
        fNumber = Number.isInteger(fn) ? String(Math.round(fn)) : fn.toFixed(1);
      }

      let expTime = '';
      if (photo.ExposureTime) {
        const et = typeof photo.ExposureTime === 'number' ? photo.ExposureTime : (photo.ExposureTime.numerator / photo.ExposureTime.denominator);
        expTime = et >= 1 ? Math.round(et) + 's' : '1/' + Math.round(1 / et) + 's';
      }

      let iso = '';
      if (photo.ISOSpeedRatings) {
        iso = String(photo.ISOSpeedRatings);
      }

      exifData.exposureStr = [focalLen + 'mm', 'f/' + fNumber, expTime, 'ISO' + iso].filter(Boolean).join(' ');
      exifData.modelDisp = replaceMarkII(exifData.model || exifData.make);
      exifData.rawModel = exifData.model;
      exifData.imgWidth = metadata.width;
      exifData.imgHeight = metadata.height;
    }

    console.log('[EXIF] 总耗时:', Date.now() - t0, 'ms, 返回:', exifData.model, exifData.lensModel);

    res.json({
      success: true,
      exif: exifData,
      imageUrl: `/uploads/${uploadedFile.filename}`,
    });

  } catch (err) {
    console.log('[EXIF] 错误:', err.message);
    if (uploadedFile) { try { fs.unlinkSync(uploadedFile.path); } catch(e) {} }
    res.status(500).json({ error: 'EXIF读取失败: ' + err.message });
  }
});

// ====== 生成底部水印层（服务端 Sharp 完整处理）=====
app.post('/api/generate-bottom', async (req, res) => {
  try {
    const { imagePath, logoFilename, lensModel: customLens, modelDisp: customModel, exposureStr: customExposure, dateTimeStr: customDateTime } = req.body;
    if (!imagePath || !logoFilename) return res.status(400).json({ error: '缺少参数' });

    // imagePath 是相对路径如 /uploads/xxx.jpg
    const fullImagePath = path.join(PUBLIC_DIR, imagePath.replace(/^\//, ''));
    const fullLogoPath = path.join(LOGOS_DIR, logoFilename);

    if (!fs.existsSync(fullImagePath)) return res.status(404).json({ error: '图片不存在' });
    if (!fs.existsSync(fullLogoPath)) return res.status(404).json({ error: 'Logo不存在' });

    // 读取原图尺寸（不动原图本身）
    const srcMeta = await sharp(fullImagePath).metadata();
    const srcW = srcMeta.width;
    const srcH = srcMeta.height;

    // 读取 Logo 尺寸
    const logoMeta = await sharp(fullLogoPath).metadata();
    const logoW = logoMeta.width;
    const logoH = logoMeta.height;

    // 读取 EXIF
    const exifData = await readExifZdK(fullImagePath);

    // 文字颜色映射（同 zdklogoprj Android）
    const colorMap = {
      'applelogo.png': 'black',
      'canonlogo.png': 'black',
      'cpslogo.png': 'black',
      'haseelbellogo.png': 'white',
      'longlogo.jpg': '#D4AF37',
      'nikonlogo.png': 'black',
      'whitelogohdr1hdr.jpg': 'black',
      'puregray.png': 'white',
      'zdkoldlogoblack.jpg': 'white',
    };
    const textColor = colorMap[logoFilename] || 'black';

    // 构造文字
    const model = customModel || exifData.modelDisp;
    const lens = customLens || exifData.lensModel;
    const exposure = customExposure || exifData.exposureStr;
    const dateTime = customDateTime || exifData.dateTimeStr;

    // === Android zdklogoprj 像素级逻辑 ===
    // 四个文本位置（精确匹配 Android Canvas.drawText）：
    // (200,155) 和 (200,250) 是左对齐
    // (3085,155) 和 (3085,250) 是右对齐的文本起点
    // Android textAlign 默认是 LEFT，所以右边需要计算字符串宽度后偏移

    // Android zdklogoprj 参考布局 (4032x354 canvas)，按比例缩放
    // 左对齐：(200,155) model, (200,250) lens
    // 右对齐：(3085,155) exposure, (3085,250) datetime
    function buildTextSvg(w, h, color, modelTxt, lensTxt, expTxt, dtTxt) {
      var leftX  = Math.round(w * 200 / 4032);
      var rightX = Math.round(w * 3085 / 4032);
      var y1     = Math.round(h * 155 / 354);
      var y2     = Math.round(h * 250 / 354);
      var fsz    = Math.round(h * 62 / 354);

      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">';
      svg += '<style>text { font-family: "Noto Sans CJK SC", sans-serif; font-size: ' + fsz + 'px; } .bold { font-weight: bold; }</style>';

      if (modelTxt) svg += '<text x="' + leftX + '" y="' + y1 + '" fill="' + color + '" class="bold" text-anchor="start">' + escapeXml(modelTxt) + '</text>';
      if (lensTxt)  svg += '<text x="' + leftX + '" y="' + y2 + '" fill="' + color + '" text-anchor="start">' + escapeXml(lensTxt) + '</text>';
      if (expTxt)   svg += '<text x="' + rightX + '" y="' + y1 + '" fill="' + color + '">' + escapeXml(expTxt) + '</text>';
      if (dtTxt)    svg += '<text x="' + rightX + '" y="' + y2 + '" fill="' + color + '">' + escapeXml(dtTxt) + '</text>';

      svg += '</svg>';
      return svg;
    }

    function escapeXml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    const svgText = buildTextSvg(logoW, logoH, textColor, model, lens, exposure, dateTime);

    // 生成 bottom 层：用 logo 作背景 + composite 文字 SVG（透明背景）
    const bottomBuf = await sharp(fullLogoPath)
      .composite([{ input: Buffer.from(svgText), top: 0, left: 0 }])
      .jpeg({ quality: 100 })
      .toBuffer();

    // 重新解析 bottom 尺寸（jpeg encode 后尺寸不变）
    const bottomMeta = await sharp(bottomBuf).metadata();
    const bottomW = bottomMeta.width;
    const bottomH = bottomMeta.height;

    // 等比缩放，宽度填满图片
    const scale = srcW / Math.max(bottomW, bottomH);
    const scaledW = Math.round(bottomW * scale);
    const scaledH = Math.round(bottomH * scale);

    // 缩放到最终尺寸
    const finalBottom = await sharp(bottomBuf)
      .resize(scaledW, scaledH, { fit: 'fill' })
      .jpeg({ quality: 100 })
      .toBuffer();

    // 保存
    const outputFilename = `bottom_${uuidv4()}.jpg`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    fs.writeFileSync(outputPath, finalBottom);

    const bottomResultMeta = await sharp(finalBottom).metadata();

    res.json({
      success: true,
      imgWidth: srcW,
      imgHeight: srcH,
      bottomWidth: bottomResultMeta.width,
      bottomHeight: bottomResultMeta.height,
      scale: scale,
      bottomUrl: `/output/${outputFilename}`,
    });

  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: '生成失败: ' + err.message });
  }
});

// ====== 读取 EXIF（zdklogoprj 精确实现） ======
async function readExifZdK(filePath) {
  const metadata = await sharp(filePath).metadata();
  if (!metadata.exif) return { model: '', lensModel: '', exposureStr: '', dateTimeStr: '', modelDisp: '' };

  const exifParser = require('exif-reader');
  const parsed = exifParser(metadata.exif);
  const img = parsed.Image || {};
  const photo = parsed.Photo || {};

  const model = img.Model || '';
  const lensModel = photo.LensModel || '';
  const modelDisp = replaceMarkII(model || img.Make || '');

  // 时间
  let dateTimeStr = '';
  const dt = photo.DateTimeOriginal;
  if (dt instanceof Date) {
    // exif-reader 把 EXIF 本地时间存成 UTC，必须用 getUTC* 解回原始值
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const mm = String(dt.getUTCMinutes()).padStart(2, '0');
    const ss = String(dt.getUTCSeconds()).padStart(2, '0');
    dateTimeStr = `${y}.${m}.${d} ${hh}:${mm}:${ss}`;
  } else if (dt) {
    dateTimeStr = String(dt).replace(/[:-]/g, '.').replace(/^(\d{4})[:-](\d{2})[:-](\d{2})/, '$1.$2.$3');
  }

  // 焦距
  let focalLen = '';
  if (photo.FocalLength) {
    const fl = typeof photo.FocalLength === 'number' ? photo.FocalLength : (photo.FocalLength.numerator / photo.FocalLength.denominator);
    focalLen = Number.isInteger(fl) ? String(Math.round(fl)) : fl.toFixed(1);
  }
  if (photo.FocalLengthIn35mmFilm && model !== 'GFX100S') {
    focalLen = String(photo.FocalLengthIn35mmFilm);
  }

  let fNumber = '';
  if (photo.FNumber) {
    const fn = typeof photo.FNumber === 'number' ? photo.FNumber : (photo.FNumber.numerator / photo.FNumber.denominator);
    fNumber = Number.isInteger(fn) ? String(Math.round(fn)) : fn.toFixed(1);
  }

  let expTime = '';
  if (photo.ExposureTime) {
    const et = typeof photo.ExposureTime === 'number' ? photo.ExposureTime : (photo.ExposureTime.numerator / photo.ExposureTime.denominator);
    expTime = et >= 1 ? Math.round(et) + 's' : '1/' + Math.round(1 / et) + 's';
  }

  let iso = '';
  if (photo.ISOSpeedRatings) {
    iso = String(photo.ISOSpeedRatings);
  }

  const exposureStr = [focalLen + 'mm', 'f/' + fNumber, expTime, 'ISO' + iso].filter(Boolean).join(' ');

  return { model, lensModel, exposureStr, dateTimeStr, modelDisp };
}

function replaceMarkII(input) {
  if (!input) return '';
  let result = input.replace(/R(\d)m2/gi, 'R$1 Mark II');
  if (input === 'GFX100S') result = 'FUJI  GFX100S';
  return result;
}

// 定时清理
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  [UPLOADS_DIR, OUTPUT_DIR].forEach(dir => {
    try {
      fs.readdirSync(dir).forEach(f => {
        const fp = path.join(dir, f);
        if (now - fs.statSync(fp).mtimeMs > maxAge) fs.unlinkSync(fp);
      });
    } catch(e) {}
  });
}, 60 * 60 * 1000);

// ====== HDR Gainmap 保留水印生成（服务端 Sharp + 二进制拼接） ======
app.post('/api/generate-hdr', async (req, res) => {
  try {
    const { imagePath, logo: logoFn, lens: lensText, model: modelText, exposure: exposureText, datetime: datetimeText } = req.body;
    if (!imagePath || !logoFn) return res.status(400).json({ error: '缺少参数' });

    const filePath = path.join(PUBLIC_DIR, imagePath.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在，请重新上传' });

    const logoPath = path.join(LOGOS_DIR, logoFn);
    if (!fs.existsSync(logoPath)) {
      return res.status(400).json({ error: 'Logo不存在' });
    }

    console.log('[HDR] 开始处理:', imagePath, 'logo:', logoFn);
    const t0 = Date.now();

    // 1. 读取原始文件二进制
    const originalBuf = fs.readFileSync(filePath);
    const originalU8 = new Uint8Array(originalBuf);

    // 2. 找到主 JPEG 的 EOI（后面就是 gainmap）
    // 注意：EOI 和 gainmap SOI 之间可能有单个填充字节 0xFF
    let mainEOI = -1;
    let gainmapSOI = -1;
    for (let i = 2; i < originalU8.length - 4; i++) {
      if (originalU8[i] === 0xFF && originalU8[i+1] === 0xD9) {
        // FF D9 FF D8 = EOI 后紧跟 gainmap SOI
        if (originalU8[i+2] === 0xFF && originalU8[i+3] === 0xD8) {
          mainEOI = i;
          gainmapSOI = i + 2;
          break;
        }
        // FF D9 FF FF D8 = EOI + 填充字节 + gainmap SOI
        if (originalU8[i+2] === 0xFF && originalU8[i+3] === 0xFF && originalU8[i+4] === 0xD8) {
          mainEOI = i;
          gainmapSOI = i + 3;
          break;
        }
      }
    }
    if (mainEOI < 0) {
      mainEOI = originalU8.length - 2;
      console.log('[HDR] 未发现 gainmap（单 JPEG）');
    } else {
      console.log('[HDR] 发现 gainmap: EOI @', mainEOI, `gainmap SOI @ ${gainmapSOI} (${originalBuf.length - gainmapSOI} 字节)`);
    }

    const oldMainSize = mainEOI + 2; // 主 JPEG 大小（SOI 到 EOI 所占字节数）
    const gainmapBuf = gainmapSOI > 0 ? originalBuf.slice(gainmapSOI) : Buffer.alloc(0);

    // 3. 提取原始 APP 段（EXIF/XMP/ICC/PS/Adobe）
    function extractAppSegments(buf) {
      const src = new Uint8Array(buf);
      const segs = [];
      let foundSOS = false;
      let i = 0;
      while (i < src.length - 1 && !foundSOS) {
        if (src[i] === 0xFF && src[i+1] !== 0x00 && src[i+1] !== 0xFF) {
          const m = src[i+1];
          if (m === 0xD8) { i += 2; }
          else if (m === 0xDA) { foundSOS = true; }
          else if (m === 0xD9) { break; }
          else if (m >= 0xE0 && m <= 0xEF) {
            const len = (src[i+2] << 8) | src[i+3];
            segs.push(Buffer.from(src.slice(i, i + 2 + len)));
            i += 2 + len;
          } else if (m === 0xFE || m === 0xDD) {
            const len = (src[i+2] << 8) | src[i+3];
            i += 2 + len;
          } else {
            const len = (src[i+2] << 8) | src[i+3];
            i += 2 + len;
          }
        } else { i++; }
      }
      return segs;
    }

    const appSegments = extractAppSegments(originalU8.slice(0, mainEOI + 2));
    const appTotal = appSegments.reduce((s, seg) => s + seg.length, 0);
    console.log('[HDR] APP 段:', appSegments.length, '共', appTotal, '字节');

    // 4. 读取 EXIF 水印文字
    let modelDisp = modelText, lensDisp = lensText, expDisp = exposureText, dtDisp = datetimeText;
    if (!modelDisp || !lensDisp || !expDisp || !dtDisp) {
      const exif = await readExifZdK(filePath).catch(() => ({}));
      if (!modelDisp) modelDisp = exif.modelDisp || '';
      if (!lensDisp) lensDisp = exif.lensModel || '';
      if (!expDisp) expDisp = exif.exposureStr || '';
      if (!dtDisp) dtDisp = exif.dateTimeStr || '';
    }

    // 5. 原图 + Logo 尺寸
    const srcMeta = await sharp(filePath).metadata();
    const srcW = srcMeta.width;
    const srcH = srcMeta.height;

    const logoMeta = await sharp(logoPath).metadata();
    const logoW = logoMeta.width;
    const logoH = logoMeta.height;

    // 颜色
    const colorMap = {
      'applelogo.png': 'black', 'canonlogo.png': 'black', 'cpslogo.png': 'black',
      'haseelbellogo.png': 'white', 'longlogo.jpg': '#D4AF37', 'nikonlogo.png': 'black',
      'whitelogohdr1hdr.jpg': 'black', 'puregray.png': 'white', 'zdkoldlogoblack.jpg': 'white',
    };
    const textColor = colorMap[logoFn] || 'black';

    function escXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function buildTextSvg(w, h) {
      var leftX  = Math.round(w * 200 / 4032);
      var rightX = Math.round(w * 3085 / 4032);
      var y1     = Math.round(h * 155 / 354);
      var y2     = Math.round(h * 250 / 354);
      var fsz    = Math.round(h * 62 / 354);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">';
      svg += '<style>.b { font-family: "Noto Sans CJK SC", sans-serif; font-size: ' + fsz + 'px; font-weight: bold; } .n { font-family: "Noto Sans CJK SC", sans-serif; font-size: ' + fsz + 'px; }</style>';
      if (modelDisp) svg += '<text x="' + leftX + '" y="' + y1 + '" fill="' + textColor + '" class="b">' + escXml(modelDisp) + '</text>';
      if (lensDisp) svg += '<text x="' + leftX + '" y="' + y2 + '" fill="' + textColor + '" class="n">' + escXml(lensDisp) + '</text>';
      if (expDisp) svg += '<text x="' + rightX + '" y="' + y1 + '" fill="' + textColor + '" class="n">' + escXml(expDisp) + '</text>';
      if (dtDisp) svg += '<text x="' + rightX + '" y="' + y2 + '" fill="' + textColor + '" class="n">' + escXml(dtDisp) + '</text>';
      svg += '</svg>';
      return svg;
    }

    // 6. 生成水印层
    const textSvg = buildTextSvg(logoW, logoH);
    const bottomBuf = await sharp(logoPath)
      .composite([{ input: Buffer.from(textSvg), top: 0, left: 0 }])
      .jpeg({ quality: 100 })
      .toBuffer();

    // 7. 缩放水印
    const botMeta = await sharp(bottomBuf).metadata();
    // 等比缩放，宽度填满图片
    const scale = srcW / Math.max(botMeta.width, botMeta.height);
    const scaledW = Math.round(botMeta.width * scale);
    const scaledH = Math.round(botMeta.height * scale);

    const scaledBottom = await sharp(bottomBuf)
      .resize(scaledW, scaledH, { fit: 'fill' })
      .jpeg({ quality: 100 })
      .toBuffer();

    // 8. Sharp 合成主 JPEG（原始 + 水印）
    // ⚠️ JPEG 不支持透明通道，composite 会裁剪超出原图范围的内容
    // 先用 extend 扩展底部，再 composite
    // ⚠️ 质量很重要！Gainmap HDR 重建依赖精确的 SDR 基像素
    // 质量 92 约 2.1MB → 与原图 5.6MB 差异过大，HDR 会错位
    const bottomColor = ['haseelbellogo.png', 'whitelogohdr1hdr.jpg', 'puregray.png', 'zdkoldlogoblack.jpg'].includes(logoFn)
      ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
    const mainBuf = await sharp(filePath)
      .resize(srcW, srcH, { fit: 'fill' }) // 保持原尺寸
      .extend({ bottom: scaledH, background: bottomColor })
      .composite([{ input: scaledBottom, top: srcH, left: 0 }])
      .jpeg({ quality: 98, chromaSubsampling: '4:4:4' })
      .toBuffer();

    console.log('[HDR] Sharp 合成完成:', mainBuf.length, '字节');

    // 9. 注入 APP 标记到新 JPEG
    const newU8 = new Uint8Array(mainBuf);
    // 找新 JPEG 第一个非 SOI marker
    let firstM = 2;
    while (firstM < newU8.length - 1) {
      if (newU8[firstM] === 0xFF && newU8[firstM+1] !== 0x00 && newU8[firstM+1] !== 0xFF && newU8[firstM+1] !== 0xD8) break;
      firstM++;
    }
    if (firstM >= newU8.length - 1) firstM = 2;
    const newBody = newU8.slice(firstM);

    // 构建：新 SOI(2) + APP段 + 新主体
    const mainInjected = Buffer.alloc(2 + appTotal + newBody.length);
    mainInjected.set([0xFF, 0xD8], 0);
    let off = 2;
    for (const seg of appSegments) { mainInjected.set(seg, off); off += seg.length; }
    mainInjected.set(newBody, off);

    console.log('[HDR] 注入后主 JPEG:', mainInjected.length, '字节');

    // 10. 修复主 JPEG 的 MPF（偏移 + img0/img1 大小）
    // MPF（Multi-Picture Format）在主 JPEG 的 APP2 段中，指向 gainmap 在文件中的位置
    // 主 JPEG 尺寸变了→gainmap 位置变了→MPF 偏移必须同步更新
    // 同时也更新 img0.size（主JPEG大小）和 img1.size（gainmap大小）
    const newMainSize = mainInjected.length;
    const sizeDelta = newMainSize - oldMainSize;

    function fixMPFOptimized(buf, newMainSz, newGmSz) {
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length - 14; i++) {
        if (u8[i] === 0xFF && u8[i+1] === 0xE2) {
          const mlen = (u8[i+2] << 8) | u8[i+3];
          if (mlen >= 14 && u8[i+4] === 0x4D && u8[i+5] === 0x50 && u8[i+6] === 0x46 && u8[i+7] === 0x00) {
            const ts = i + 8;
            const bo = String.fromCharCode(u8[ts], u8[ts+1]);
            if (bo !== 'II' && bo !== 'MM') break;
            const isLE = (bo === 'II');
            const r16 = (p) => isLE ? (u8[p] | (u8[p+1] << 8)) : ((u8[p] << 8) | u8[p+1]);
            const r32 = (p) => isLE
              ? (u8[p] | (u8[p+1]<<8) | (u8[p+2]<<16) | (u8[p+3]<<24))
              : ((u8[p]<<24) | (u8[p+1]<<16) | (u8[p+2]<<8) | u8[p+3]);
            const w32 = (p, v) => {
              if (isLE) {
                u8[p] = v & 0xFF;
                u8[p+1] = (v>>8) & 0xFF;
                u8[p+2] = (v>>16) & 0xFF;
                u8[p+3] = (v>>24) & 0xFF;
              } else {
                u8[p] = (v>>24) & 0xFF;
                u8[p+1] = (v>>16) & 0xFF;
                u8[p+2] = (v>>8) & 0xFF;
                u8[p+3] = v & 0xFF;
              }
            };

            if (r16(ts+2) === 0x002A) {
              const ifd0Off = r32(ts+4);
              const ifd0 = ts + ifd0Off;
              const num = r16(ifd0);

              for (let e = 0; e < num; e++) {
                const entry = ifd0 + 2 + e * 12;
                if (r16(entry) === 0xB002) { // MPEntry tag
                  const count = r32(entry + 4);
                  const dataOff = r32(entry + 8);

                  if (dataOff > 4) {
                    const mpData = ts + dataOff;
                    const numImages = count / 16;

                    // img 0: 主 JPEG - 更新大小（offset=0 不变）
                    w32(mpData + 4, newMainSz);

                    // img 1+: gainmap - 更新偏移
                    for (let img = 1; img < numImages; img++) {
                      const mpE = mpData + img * 16;
                      const oldOff = r32(mpE + 8);
                      const oldSz = r32(mpE + 4);
                      const newOff = oldOff + (newMainSz - oldMainSize);
                      w32(mpE + 8, newOff);
                      if (newGmSz !== undefined) {
                        w32(mpE + 4, newGmSz);
                      }
                      console.log('[HDR] MPF 更新: img', img,
                        'offset', '0x' + oldOff.toString(16), '→ 0x' + newOff.toString(16),
                        'size', oldSz, '→', newGmSz || oldSz);
                    }
                  }
                  break;
                }
              }
            }
            break;
          }
        }
      }
      return Buffer.from(u8);
    }

    // 10. 扩展 gainmap + 注入原始 APP 段
    // gainmap JPEG 自己也有 APP1(EXIF/XMP) 含 hdrgm:HDRCapacityMin/Max,
    // OffsetSDR, Gamma 等参数。Sharp 重编码会丢弃这些 APP 段，
    // HDR viewer 收不到这些参数就无法解析 gainmap → 回到 SDR。
    // 解决方法：Sharp 输出后把原始 gainmap 的 APP 段注入回去。

    // 10a. 从原始 gainmap JPEG 中提取 APP 段
    const gmAppSegments = extractAppSegments(gainmapBuf);
    const gmAppTotal = gmAppSegments.reduce((s, seg) => s + seg.length, 0);
    console.log('[HDR] Gainmap APP 段:', gmAppSegments.length, '共', gmAppTotal, '字节');

    // 10b. 用 Sharp 扩展 gainmap（quality 100 + 4:4:4 同 Android 原生编码器）
    // ⚠️ 关键：gainmap 的分辨率通常低于主图（如 1/4），扩展量必须按比例缩放
    //    否则 gainmap 和主图的宽高比不一致 → HDR 重建时 gainmap 映射错位
    //    例：主图 4032×3024 + 水印条 200px → 4032×3224
    //       gainmap 1008×756 + 水印条 50px (200*756/3024) → 1008×806
    //       宽高比：4032/3224 = 1008/806 ≈ 1.25 ✅ 一致
    let extendedGmRaw;
    let gmExtend = scaledH; // fallback: 同主图
    try {
      const gmMeta = await sharp(gainmapBuf).metadata();
      if (gmMeta.width && gmMeta.height && srcH > 0) {
        gmExtend = Math.round(scaledH * gmMeta.height / srcH);
        console.log('[HDR] Gainmap 尺寸:', gmMeta.width, '×', gmMeta.height,
          '| 水印扩展:', scaledH, '→', gmExtend, '(比例', gmMeta.height/srcH, ')');
      }
    } catch (e) {
      console.warn('[HDR] 无法读取 gainmap 尺寸，使用主图扩展量:', e.message);
    }
    try {
      extendedGmRaw = await sharp(gainmapBuf)
        .extend({ top: 0, bottom: gmExtend, background: { r: 128, g: 128, b: 128 } })
        .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
        .toBuffer();
      console.log('[HDR] Gainmap 扩展:', gainmapBuf.length, '→', extendedGmRaw.length, '字节');
    } catch (e) {
      console.warn('[HDR] Gainmap 扩展失败（保留原始）:', e.message);
      extendedGmRaw = null;
    }

    // 10c. 将原始 gainmap 的 APP 段注入到扩展后的 gainmap JPEG 中
    let extendedGm;
    if (extendedGmRaw && gmAppSegments.length > 0) {
      const gmU8 = new Uint8Array(extendedGmRaw);
      let gmFirstM = 2;
      while (gmFirstM < gmU8.length - 1) {
        if (gmU8[gmFirstM] === 0xFF && gmU8[gmFirstM+1] !== 0x00 && gmU8[gmFirstM+1] !== 0xFF && gmU8[gmFirstM+1] !== 0xD8) break;
        gmFirstM++;
      }
      if (gmFirstM >= gmU8.length - 1) gmFirstM = 2;
      const gmBody = gmU8.slice(gmFirstM);
      const gmInjected = Buffer.alloc(2 + gmAppTotal + gmBody.length);
      gmInjected.set([0xFF, 0xD8], 0);
      let off = 2;
      for (const seg of gmAppSegments) { gmInjected.set(seg, off); off += seg.length; }
      gmInjected.set(gmBody, off);
      extendedGm = gmInjected;
      console.log('[HDR] Gainmap APP 注入完成:', extendedGm.length, '字节');
    } else {
      extendedGm = extendedGmRaw || gainmapBuf;
    }

    // 10d. 更新 MPF：偏移 + img0/img1 大小
    let mainFixed = fixMPFOptimized(mainInjected, newMainSize, extendedGm.length);
    console.log('[HDR] 主 JPEG 大小:', oldMainSize, '→', newMainSize, 'delta:', sizeDelta);

    // 11. 拼接：修复后主 JPEG + 扩展后 gainmap
    const finalBuf = Buffer.concat([mainFixed, extendedGm]);

    console.log('[HDR] 完成! 文件:', finalBuf.length, '字节, 耗时:', Date.now() - t0, 'ms');

    // 12. 返回
    const origName = req.body.originalName || path.basename(imagePath);
    const baseName = path.parse(origName).name;
    const outName = baseName + '_waterMarked.jpg';
    const outPath = path.join(OUTPUT_DIR, outName);
    fs.writeFileSync(outPath, finalBuf);

    res.json({
      success: true,
      width: srcW,
      height: srcH + scaledH,
      url: '/output/' + outName,
      size: finalBuf.length
    });

  } catch (err) {
    console.error('[HDR] 错误:', err.message, err.stack);
    res.status(500).json({ error: '生成失败: ' + err.message });
  }
});

app.listen(PORT, '::', () => {
  console.log(`✅ ZDK Logo 服务已启动: http://0.0.0.0:${PORT}`);
  console.log(`   Logo 数量: ${fs.readdirSync(LOGOS_DIR).length}`);
});
