const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

async function main() {
  const file = path.resolve(__dirname, "../build/icon-256.png");
  const browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() =>
    chromium.launch({ headless: true })
  );
  const page = await browser.newPage();
  const b64 = fs.readFileSync(file).toString("base64");
  const info = await page.evaluate(async (b64png) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64png;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    // 找蓝色区域
    let bMinX = width,
      bMinY = height,
      bMaxX = -1,
      bMaxY = -1;
    let tMinX = width,
      tMinY = height,
      tMaxX = -1,
      tMaxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2],
          a = data[i + 3];
        if (a < 128) continue;
        const isBlue = b > 180 && r < 100 && g < 140;
        const isWhite = r > 220 && g > 220 && b > 220;
        if (isBlue || isWhite) {
          if (x < bMinX) bMinX = x;
          if (y < bMinY) bMinY = y;
          if (x > bMaxX) bMaxX = x;
          if (y > bMaxY) bMaxY = y;
        }
        if (isWhite) {
          if (x < tMinX) tMinX = x;
          if (y < tMinY) tMinY = y;
          if (x > tMaxX) tMaxX = x;
          if (y > tMaxY) tMaxY = y;
        }
      }
    }
    return {
      blue: { bMinX, bMinY, bMaxX, bMaxY },
      text: { tMinX, tMinY, tMaxX, tMaxY },
      gapTop: tMinY - bMinY,
      gapBottom: bMaxY - tMaxY,
      gapLeft: tMinX - bMinX,
      gapRight: bMaxX - tMaxX,
    };
  }, b64);
  await browser.close();
  console.log(JSON.stringify(info, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
