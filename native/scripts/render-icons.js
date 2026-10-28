#!/usr/bin/env node
"use strict";
// Renders native/resources/*.svg into the PNG sources @capacitor/assets cuts every platform's app
// icon and launch screen from. Run `npm run assets` after changing the artwork.
const path = require("path");
const sharp = require("sharp");

const dir = path.join(__dirname, "..", "resources");
const BRAND_GREEN = "#24382f";

async function render() {
  const icon = (name) => sharp(path.join(dir, `${name}.svg`), { density: 144 }).resize(1024, 1024).png();
  await icon("icon").toFile(path.join(dir, "icon-only.png"));
  await icon("icon-foreground").toFile(path.join(dir, "icon-foreground.png"));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BRAND_GREEN } }).png().toFile(path.join(dir, "icon-background.png"));
  for (const name of ["splash", "splash-dark"]) {
    await sharp(path.join(dir, "splash.svg")).resize(2732, 2732).png().toFile(path.join(dir, `${name}.png`));
  }
}

render().catch((error) => {
  console.error(error);
  process.exit(1);
});
