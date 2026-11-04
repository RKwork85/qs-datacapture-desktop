const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

async function measure(svgText) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  } catch (_) {
    browser = await chromium.launch({ headless: true });
  }
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#000">${svgText}</body></html>`,
    { waitUntil: "load" }
  );
  const metrics = await page.evaluate(() => {
    const t = document.querySelector("text");
    const r = t.getBBox();
    const blueTop = 48;
    const blueBottom = 48 + 416;
    return {
      bbox: { x: r.x, y: r.y, w: r.width, h: r.height },
      gapTop: r.y - blueTop,
      gapBottom: blueBottom - (r.y + r.height),
      gapLeft: r.x - 48,
      gapRight: 48 + 416 - (r.x + r.width),
      midY: r.y + r.height / 2,
      midX: r.x + r.width / 2,
    };
  });
  await browser.close();
  return metrics;
}

async function main() {
  const svgPath = path.resolve(__dirname, "../build/icon.svg");
  let svg = fs.readFileSync(svgPath, "utf8");
  let m = await measure(svg);
  console.log("before", m);

  // 把文字几何中心移到蓝色块中心 (256,256)
  const dy = 256 - m.midY;
  const dx = 256 - m.midX;
  console.log("nudge dx,dy", dx, dy);

  // 用 transform 精确平移（保留 font metrics）
  if (!/transform=/.test(svg)) {
    svg = svg.replace(
      /<text([\s\S]*?)>/,
      `<text$1 transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)})">`
    );
  } else {
    svg = svg.replace(
      /transform="translate\([^"]+\)"/,
      `transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)})"`
    );
  }
  fs.writeFileSync(svgPath, svg);
  m = await measure(svg);
  console.log("after", m);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
