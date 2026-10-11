#!/usr/bin/env node
"use strict";

// Bake the existing icon motion into independent animated PNGs for marketing.
// Usage: node scripts/generate-home-icon-motion.js
// Only this generator reads app code; the homepage loads its own image assets.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const root = path.join(__dirname, "..");
const aliases = { campsite: "landmark-campsite", parking: "landmark-parking", monument: "landmark-monument" };

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function animate(frames) {
  const chunks = [frames[0].subarray(0, 8)];
  const control = Buffer.alloc(8);
  control.writeUInt32BE(frames.length); // zero play count loops indefinitely
  let sequence = 0;
  frames.forEach((png, index) => {
    const imageData = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      const type = png.toString("ascii", offset + 4, offset + 8);
      const data = png.subarray(offset + 8, offset + 8 + length);
      if (type === "IHDR" && index === 0) chunks.push(chunk(type, data), chunk("acTL", control));
      if (type === "IDAT") imageData.push(data);
      offset += length + 12;
    }
    const frame = Buffer.alloc(26);
    frame.writeUInt32BE(sequence++, 0);
    frame.writeUInt32BE(96, 4);
    frame.writeUInt32BE(96, 8);
    frame.writeUInt16BE(1, 20);
    frame.writeUInt16BE(15, 22); // 15 frames per second; replace the entire frame
    chunks.push(chunk("fcTL", frame));
    const data = Buffer.concat(imageData);
    if (index === 0) chunks.push(chunk("IDAT", data));
    else {
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(sequence++);
      chunks.push(chunk("fdAT", Buffer.concat([prefix, data])));
    }
  });
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, "js/icon-motion.js"), "utf8") });
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const sources = new Set(Array.from(html.matchAll(/data-inventory-key="[^"]+"><dt><img src="([^"]+)"/g), match => match[1]));
    const output = path.join(root, "assets/home/map-icons/animated");
    fs.mkdirSync(output, { recursive: true });
    for (const source of sources) {
      const name = path.basename(source, ".png");
      const image = "data:image/png;base64," + fs.readFileSync(path.join(root, source)).toString("base64");
      const frames = await page.evaluate(async ({ image, slug }) => {
        const original = new Image();
        original.src = image;
        await original.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 96;
        const context = canvas.getContext("2d");
        const frames = [];
        for (let frame = 0; frame < 90; frame++) {
          context.clearRect(0, 0, 96, 96);
          if (!IconMotion.draw(context, original, slug, 0, 0, 96, frame / 15)) throw new Error("Unsupported icon: " + slug);
          frames.push(canvas.toDataURL().split(",")[1]);
        }
        return frames;
      }, { image, slug: aliases[name] || name });
      fs.writeFileSync(path.join(output, name + ".png"), animate(frames.map(frame => Buffer.from(frame, "base64"))));
      console.log(name);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
