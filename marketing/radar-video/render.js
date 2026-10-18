// Renders index.html frame-by-frame through headless Edge and pipes the frames into ffmpeg.
//   node render.js                 -> out/planera-radar-9x16.mp4
//   node render.js --stills 1,3,6  -> out/still-<t>.png for quick checks
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT = path.join(__dirname, "out");
const url = "file:///" + path.join(__dirname, "index.html").replace(/\\/g, "/");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--allow-file-access-from-files", "--hide-scrollbars", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("page:", m.text()); });
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.ready);
  const fontOk = await page.evaluate(() => document.fonts.check('800 100px Inter'));
  if (!fontOk) throw new Error("Inter did not load");
  const { DURATION, FPS } = await page.evaluate(() => ({ DURATION: window.DURATION, FPS: window.FPS }));

  const stillsArg = process.argv.indexOf("--stills");
  if (stillsArg !== -1) {
    for (const t of process.argv[stillsArg + 1].split(",").map(Number)) {
      await page.evaluate((t) => window.render(t), t);
      await page.screenshot({ path: path.join(OUT, `still-${t}.png`) });
    }
    await browser.close();
    return;
  }

  const file = path.join(OUT, "planera-radar-9x16.mp4");
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });

  const frames = Math.round(DURATION * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 30 === 0) process.stdout.write(`\r${f}/${frames}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await browser.close();
  console.log(`\nwrote ${file}`);
})().catch((e) => { console.error(e); process.exit(1); });
