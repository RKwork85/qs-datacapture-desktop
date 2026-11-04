/**
 * 按「白色字形像素」在蓝色块内光学/几何居中，再写出 icon.svg 并生成各尺寸。
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BUILD = path.resolve(__dirname, "../build");
const BLUE = { x: 48, y: 48, w: 416, h: 416 };
const CENTER = { x: BLUE.x + BLUE.w / 2, y: BLUE.y + BLUE.h / 2 };

function svgTemplate(dx, dy, fontSize = 240) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="48" y="48" width="416" height="416" rx="92" ry="92" fill="#2563eb"/>
  <text
    x="256"
    y="256"
    text-anchor="middle"
    dominant-baseline="central"
    transform="translate(${dx} ${dy})"
    font-family="Segoe UI, Arial, Helvetica, sans-serif"
    font-size="${fontSize}"
    font-weight="700"
    fill="#ffffff"
  >QS</text>
</svg>
`;
}

async function launch() {
  try {
    return await chromium.launch({ headless: true, channel: "chrome" });
  } catch (_) {
    return chromium.launch({ headless: true });
  }
}

async function inkBounds(browser, svg) {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#000">${svg}</body></html>`,
    { waitUntil: "load" }
  );
  const png = await page.screenshot({
    type: "png",
    omitBackground: false,
    clip: { x: 0, y: 0, width: 512, height: 512 },
  });
  await page.close();

  // 解析 PNG：找接近白色的像素包围盒（在蓝色区域内）
  // 使用 Playwright 再开一页用 createImageBitmap 太重；改用简单 PNG 解码
  const { PNG } = (() => {
    try {
      return require("pngjs");
    } catch (_) {
      return { PNG: null };
    }
  })();

  let data;
  let width = 512;
  let height = 512;
  if (PNG) {
    const img = PNG.sync.read(png);
    data = img.data;
    width = img.width;
    height = img.height;
  } else {
    // 无 pngjs：用浏览器读像素
    const p2 = await browser.newPage();
    const b64 = png.toString("base64");
    const pixels = await p2.evaluate(async (b64png) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64png;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      return { data: Array.from(data), width, height };
    }, b64);
    await p2.close();
    data = pixels.data;
    width = pixels.width;
    height = pixels.height;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = BLUE.y; y < BLUE.y + BLUE.h; y++) {
    for (let x = BLUE.x; x < BLUE.x + BLUE.w; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 白色字形（排除蓝色底）
      if (r > 220 && g > 220 && b > 220) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("未检测到白色字形像素");
  return {
    minX,
    minY,
    maxX,
    maxY,
    midX: (minX + maxX) / 2,
    midY: (minY + maxY) / 2,
    gapTop: minY - BLUE.y,
    gapBottom: BLUE.y + BLUE.h - 1 - maxY,
    gapLeft: minX - BLUE.x,
    gapRight: BLUE.x + BLUE.w - 1 - maxX,
  };
}

async function main() {
  const browser = await launch();
  let dx = 0;
  let dy = 0;
  let svg = svgTemplate(dx, dy);
  let ink = await inkBounds(browser, svg);
  console.log("pass0", ink);

  // 迭代 2 次把墨水中心对齐到蓝色中心
  for (let i = 0; i < 3; i++) {
    const ndx = CENTER.x - ink.midX;
    const ndy = CENTER.y - ink.midY;
    dx += ndx;
    dy += ndy;
    svg = svgTemplate(dx, dy);
    ink = await inkBounds(browser, svg);
    console.log(`pass${i + 1}`, { dx, dy, ...ink });
    if (Math.abs(ndx) < 0.5 && Math.abs(ndy) < 0.5) break;
  }

  fs.writeFileSync(path.join(BUILD, "icon.svg"), svg);
  await browser.close();
  console.log("icon.svg updated; gaps", {
    top: ink.gapTop,
    bottom: ink.gapBottom,
    left: ink.gapLeft,
    right: ink.gapRight,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
