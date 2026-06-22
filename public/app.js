/**
 * ZDK 水印 — 服务端 HDR Gainmap 保留方案
 * 
 * 策略：
 * 1. 上传原图到服务端（保存到 uploads/）
 * 2. 服务端提取 EXIF，前端展示
 * 3. 点击生成 → POST /api/generate-hdr → 服务端 Sharp 合成 + 二进制拼接 gainmap
 * 4. 返回完整 HDR JPEG，浏览器下载
 */

const state = { selectedLogo: null, exif: null, imagePath: null, srcExt: null };

const $ = id => document.getElementById(id);
const logoGrid = $('logoGrid');
const dropZone = $('dropZone');
const dropContent = $('dropContent');
const previewArea = $('previewArea');
const previewImage = $('previewImage');
const fileInput = $('fileInput');
const changePhotoBtn = $('changePhotoBtn');
const exifInfo = $('exifInfo');
const exifFields = $('exifFields');
const generateBtn = $('generateBtn');
const progressBar = $('progressBar');
const progressFill = $('progressFill');
const progressStatus = $('progressStatus');
const errorMsg = $('errorMsg');
const resultArea = $('resultArea');
const resultImage = $('resultImage');
const downloadLink = $('downloadLink');

// 4 个字段：每个有 [checkbox, input, badge, exif key]
const fields = [
  { cb:  $('useModelCb'),     inp: $('modelInput'),    badge: $('modelBadge'),    exifKey: 'modelDisp',     fallback: 'model' },
  { cb:  $('useLensCb'),      inp: $('lensInput'),     badge: $('lensBadge'),     exifKey: 'lensModel',     fallback: null },
  { cb:  $('useExposureCb'),  inp: $('exposureInput'), badge: $('exposureBadge'), exifKey: 'exposureStr',   fallback: null },
  { cb:  $('useDatetimeCb'),  inp: $('datetimeInput'), badge: $('datetimeBadge'), exifKey: 'dateTimeStr',   fallback: null },
];

function showProgress(text, pct) {
  if (!progressBar) return;
  progressBar.style.display = 'block';
  progressFill.style.width = pct + '%';
  progressStatus.textContent = text;
}

// ====== 字段勾选逻辑 ======
// 从 EXIF 中读取某个字段的值
function getExifValue(field) {
  const exif = state.exif;
  if (!exif) return '';
  let v = exif[field.exifKey] || '';
  if (!v && field.fallback) v = exif[field.fallback] || '';
  return v;
}

// 应用单个字段的勾选状态
function applyField(field) {
  if (field.cb.checked && state.exif) {
    // ✅ EXIF 模式，有数据
    field.inp.value = getExifValue(field);
    field.inp.disabled = true;
    field.inp.placeholder = 'EXIF 未找到';
    field.badge.textContent = 'EXIF';
    field.badge.className = 'mode-badge exif';
  } else if (field.cb.checked && !state.exif) {
    // ✅ EXIF 模式，但还未上传图片
    field.inp.value = '';
    field.inp.disabled = true;
    field.inp.placeholder = '请先上传图片';
    field.badge.textContent = 'EXIF';
    field.badge.className = 'mode-badge exif';
  } else {
    // ✏️ 手动编辑模式
    field.inp.disabled = false;
    field.inp.placeholder = '手动输入';
    field.badge.textContent = '手动';
    field.badge.className = 'mode-badge manual';
  }
}

// 应用所有字段的勾选状态
function applyAllFields() {
  fields.forEach(applyField);
}

// 绑定单个字段的 checkbox change 事件
function bindFieldToggle(field) {
  field.cb.addEventListener('change', () => applyField(field));
}

function setAllInputsDisabled(disabled) {
  fields.forEach(f => { f.inp.disabled = disabled; });
}

// 用 EXIF 填充所有输入框（不关心 checkbox 状态）
function fillAllInputs() {
  const exif = state.exif;
  if (!exif) return;
  fields.forEach(f => {
    f.inp.value = getExifValue(f);
  });
}

function clearAllInputs() {
  fields.forEach(f => { f.inp.value = ''; });
}

// ====== Logo 加载 ======
async function loadLogos() {
  const res = await fetch('/api/logos');
  const data = await res.json();
  renderLogos(data.logos);
}

function renderLogos(logos) {
  logoGrid.innerHTML = '';
  logos.forEach(l => {
    const div = document.createElement('div');
    div.className = 'logo-item';
    div.dataset.filename = l.filename;
    const img = document.createElement('img');
    img.src = `/logos/${l.filename}`;
    img.alt = l.name;
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; };
    const name = document.createElement('div');
    name.className = 'logo-name';
    name.textContent = l.name;
    div.append(img, name);
    div.addEventListener('click', () => selectLogo(l.filename));
    logoGrid.appendChild(div);
  });
}

function selectLogo(filename) {
  document.querySelectorAll('.logo-item').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.logo-item[data-filename="${filename}"]`);
  if (el) el.classList.add('selected');
  state.selectedLogo = filename;
  updateGenerateBtn();
}

// ====== 上传 ======
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
changePhotoBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

async function handleFile(file) {
  if (!file.type.startsWith('image/')) return showError('请上传图片文件');
  hideError();
  hideResult();
  // 清除上次的 EXIF 显示
  exifInfo.style.display = 'none';
  exifFields.innerHTML = '';
  clearAllInputs();
  state.exif = null;
  state.imagePath = null;
  updateGenerateBtn();
  state.originalName = file.name;
  state.srcExt = file.name.match(/\.(\w+)$/)?.[1]?.toLowerCase() || 'jpg';

  // 1. 预览
  showProgress('正在加载预览...', 5);
  const previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  await new Promise((resolve, reject) => {
    previewImage.onload = resolve;
    previewImage.onerror = () => { showError('预览加载失败'); reject(); };
  });
  dropContent.style.display = 'none';
  previewArea.style.display = 'block';
  state.previewUrl = previewUrl;

  // 2. 上传到服务端
  showProgress('正在上传图片...', 10);
  const formData = new FormData();
  formData.append('photo', file);
  let exifRes;
  try {
    exifRes = await fetch('/api/exif', { method: 'POST', body: formData }).then(r => r.json());
  } catch (err) {
    showError('上传失败: ' + err.message);
    progressBar.style.display = 'none';
    return;
  }
  if (!exifRes.success) {
    showError('EXIF 读取失败: ' + (exifRes.error || ''));
    progressBar.style.display = 'none';
    return;
  }

  state.exif = exifRes.exif;
  state.imagePath = exifRes.imageUrl;

  exifInfo.style.display = 'block';
  renderExif(exifRes.exif);
  // 填充输入框 + 应用勾选状态（默认全勾=只读）
  fillAllInputs();
  applyAllFields();
  updateGenerateBtn();
  progressBar.style.display = 'none';
}

function renderExif(exif) {
  exifFields.innerHTML = '';
  const displayFields = [
    ['机型', exif.modelDisp || exif.model || '-'],
    ['镜头', exif.lensModel || '-'],
    ['参数', exif.exposureStr || '-'],
    ['时间', exif.dateTimeStr || '-'],
    ['尺寸', (exif.imgWidth || '?') + '×' + (exif.imgHeight || '?')],
  ];
  displayFields.forEach(([label, value]) => {
    const div = document.createElement('div');
    div.className = 'exif-field';
    div.innerHTML = `<span class="label">${label}</span><span class="value">${value}</span>`;
    exifFields.appendChild(div);
  });
}

// ====== 生成水印（服务端 Sharp + Gainmap 保留） ======
generateBtn.addEventListener('click', generate);

async function generate() {
  if (!state.selectedLogo || !state.exif) return;
  hideError();
  hideResult();

  showProgress('正在生成 HDR 水印（保留 Gainmap）...', 10);
  generateBtn.disabled = true;
  generateBtn.textContent = '⏳ 生成中...';
  setAllInputsDisabled(true);

  try {
    showProgress('服务端处理中（大图需 10-60 秒）...', 30);
    const res = await fetch('/api/generate-hdr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagePath: state.imagePath,
        originalName: state.originalName,
        logo: state.selectedLogo,
        model: $('modelInput').value.trim(),
        lens: $('lensInput').value.trim(),
        exposure: $('exposureInput').value.trim(),
        datetime: $('datetimeInput').value.trim(),
      })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || '生成失败');
    }

    showProgress('下载中...', 80);
    const fullUrl = data.url;

    // 预览
    showProgress('加载结果...', 90);
    resultImage.src = fullUrl;
    await new Promise(r => { resultImage.onload = r; resultImage.onerror = r; });
    downloadLink.href = fullUrl;
    downloadLink.download = `${state.originalName.replace(/\.\w+$/, '')}_waterMarked.jpg`;
    resultArea.style.display = 'block';

    showProgress('✅ 完成（HDR Gainmap 已保留）', 100);
    setTimeout(() => { progressBar.style.display = 'none'; }, 2000);

  } catch (err) {
    showError('生成失败: ' + err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = '⚡ 生成水印';
    // 恢复字段勾选状态
    applyAllFields();
  }
}

function updateGenerateBtn() {
  generateBtn.disabled = !(state.selectedLogo && state.exif);
}

function hideResult() { resultArea.style.display = 'none'; }
function showError(msg) { errorMsg.style.display = 'block'; errorMsg.textContent = '❌ ' + msg; }
function hideError() { errorMsg.style.display = 'none'; }

// 绑定每个字段的 checkbox 切换事件
fields.forEach(bindFieldToggle);

loadLogos();
