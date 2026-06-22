# ZDK Logo Web — 水印合成工具

上传照片，选择相机品牌 Logo，自动读取 EXIF 信息，合成带底部水印条的图片。

## 功能

- **Logo 选择** — 12 种相机/品牌 Logo（苹果、佳能、尼康、索尼、哈苏、徕卡等）
- **EXIF 自动提取** — 上传后自动读取机型、镜头、光圈快门 ISO、拍摄时间
- **手动编辑** — 每个字段可切换 EXIF 自动填充 / 手动输入模式
- **水印合成** — 底部水印条，包含 Logo + 四行文字（机型、镜头、参数、时间），文字位置精确匹配原始 Android 项目 `zdklogoprj251118`
- **HDR Gainmap 保留** — 支持 iPhone 等设备的 HDR gainmap JPEG（ISO 21496-1），生成后仍可完整显示 HDR 效果
- **字体** — 思源黑体（Noto Sans CJK SC）
- **自动清理** — 每次上传新图片时自动清理旧文件

## 快速开始

```bash
# 安装依赖
npm install

# 启动（默认端口 9013）
PORT=9013 npm start

# 也可直接传递端口
node src/server.js
```

访问 `http://localhost:9013`

## 可用端口

| 实例 | 用途 | 端口 |
|------|------|------|
| Dev | 开发与调试 | 9013 |
| Stable | 稳定版 | 9015 |

## 项目结构

```
zdk-logo-web/
├── src/
│   └── server.js          # 后端：Express + Sharp 服务
├── public/
│   ├── index.html          # 主页面
│   ├── app.js              # 前端逻辑
│   ├── style.css           # 样式
│   ├── logos/              # Logo 素材（12个）
│   ├── uploads/            # 上传目录（自动清理）
│   └── output/             # 生成目录（自动清理）
├── node_modules/
├── package.json
└── README.md
```

## API

### `GET /api/logos`
返回 Logo 列表。

### `POST /api/exif`
上传照片（`multipart/form-data`，字段名 `photo`），返回 EXIF 数据和预览 URL。

**响应示例：**
```json
{
  "success": true,
  "exif": {
    "model": "Canon EOS R5",
    "lensModel": "RF 24–70mm f/2.8",
    "exposureStr": "50mm f/2.8 1/125s ISO100",
    "dateTimeStr": "2026.06.22 14:30:00",
    "modelDisp": "Canon EOS R5 Mark II"
  },
  "imageUrl": "/uploads/xxx.jpg"
}
```

### `POST /api/generate-hdr`
生成带水印的 HDR 图片（保留 gainmap）。

**参数**（JSON body）：
| 字段 | 说明 |
|------|------|
| `imagePath` | 上传后返回的 `/uploads/xxx.jpg` |
| `logo` | Logo 文件名（如 `leicalogo.png`） |
| `model` | 机型文字 |
| `lens` | 镜头文字 |
| `exposure` | 曝光参数文字 |
| `datetime` | 日期时间文字 |

**响应：**
```json
{
  "success": true,
  "downloadUrl": "/output/xxx_waterMarked.jpg"
}
```

### `POST /api/generate-bottom`
非 HDR 版本（不保留 gainmap），用于普通 JPEG。

## 技术栈

- **后端**: Node.js + Express + Sharp + exif-reader
- **前端**: 纯 HTML / CSS / JS（无框架）
- **文件上传**: Multer
- **图片处理**: Sharp（libvips/libjpeg-turbo）
- **字体**: Noto Sans CJK SC（思源黑体）

## HDR Gainmap 支持

本服务完整支持 ISO 21496-1 HDR gainmap JPEG 格式。这类文件包含两个 JPEG：
1. **主图（SDR）** — 可显示的普通 JPEG 图像
2. **Gainmap** — 存储在主图 EOI 之后的独立 JPEG，用于 HDR 重建

处理流程：Sharp 合成水印 → 提取并保留原始 APP 标记（EXIF/ICC/XMP/MPF） → 修正 MPF 文件偏移 → 重新注入到新主图 → 拼接原始 gainmap → 输出最终文件。

## 部署

服务监听 `::`（IPv6 + IPv4），外网可通过 IPv6 访问。
