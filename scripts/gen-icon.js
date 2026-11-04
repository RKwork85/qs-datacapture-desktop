/**
 * 从 build/icon.svg 生成各尺寸 PNG 与 icon.ico
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

async function main() {
  const pngToIcoMod = require("png-to-ico");
  const pngToIco = pngToIcoMod.default || pngToIcoMod;
  const { chromium } = require("playwright");

  const root = path.resolve(__dirname, "..");
  const build = path.join(root, "build");
  const svgPath = path.join(build, "icon.svg");
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const svgRaw = fs.readFileSync(svgPath, "utf8");

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  } catch (_) {
    browser = await chromium.launch({ headless: true });
  }

  const pngs = [];
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const svg = svgRaw
      .replace(/width="512"/, `width="${size}"`)
      .replace(/height="512"/, `height="${size}"`);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
      { waitUntil: "load" }
    );
    const out = path.join(build, `icon-${size}.png`);
    await page.screenshot({
      path: out,
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    pngs.push(out);
    console.log("wrote", out);
  }
  await browser.close();

  fs.copyFileSync(path.join(build, "icon-256.png"), path.join(build, "icon.png"));
  const buf = await pngToIco(pngs);
  fs.writeFileSync(path.join(build, "icon.ico"), buf);
  console.log("wrote icon.ico", buf.length, "bytes");
  // silence unused
  void pathToFileURL;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
