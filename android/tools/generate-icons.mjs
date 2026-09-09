import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = `${root}/android/artwork/logo-mark.svg`;
const svg = await readFile(source, 'utf8');
const path = svg.match(/\bd="([^"]+)"/)[1];
const [x, y, width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
// More white space: adaptive R 62 -> 48 dp; legacy R 32 -> 26 dp.
const adaptiveMarkSize = 48;
const legacyMarkSize = 26;
const vectorScale = adaptiveMarkSize / Math.max(width, height);
const tx = (108 - width * vectorScale) / 2 - x * vectorScale;
const ty = (108 - height * vectorScale) / 2 - y * vectorScale;
await writeFile(`${root}/android/app/src/main/res/drawable/ic_launcher_foreground.xml`,
  `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n` +
  `    <group android:scaleX="${vectorScale}" android:scaleY="${vectorScale}" android:translateX="${tx}" android:translateY="${ty}">\n` +
  `        <path android:fillColor="#00804A" android:fillType="evenOdd" android:pathData="${path}" />\n    </group>\n</vector>\n`);
for (const [density, scale] of Object.entries({mdpi:1,hdpi:1.5,xhdpi:2,xxhdpi:3,xxxhdpi:4})) {
  const folder = `${root}/android/app/src/main/res/mipmap-${density}`;
  await mkdir(folder, { recursive:true });
  const foregroundSize = Math.round(108 * scale);
  const mark = await sharp(source, {density:1200}).resize({width:Math.round(adaptiveMarkSize*scale),height:Math.round(adaptiveMarkSize*scale),fit:'inside'}).png().toBuffer();
  await sharp({create:{width:foregroundSize,height:foregroundSize,channels:4,background:'#ffffff00'}})
    .composite([{input:mark,gravity:'centre'}]).png().toFile(`${folder}/ic_launcher_foreground.png`);
  const size = Math.round(48 * scale);
  const legacyMark = await sharp(source, {density:1200}).resize({width:Math.round(legacyMarkSize*scale),height:Math.round(legacyMarkSize*scale),fit:'inside'}).png().toBuffer();
  await sharp({create:{width:size,height:size,channels:4,background:'#ffffff'}})
    .composite([{input:legacyMark,gravity:'centre'}]).png().toFile(`${folder}/ic_launcher.png`);
}
await mkdir(`${root}/android/artifacts`, {recursive:true});
const exportMark = await sharp(source, {density:1200}).resize({width:Math.round(1024*legacyMarkSize/48),height:Math.round(1024*legacyMarkSize/48),fit:'inside'}).png().toBuffer();
await sharp({create:{width:1024,height:1024,channels:4,background:'#ffffff'}})
  .composite([{input:exportMark,gravity:'centre'}]).png().toFile(`${root}/android/artifacts/icon-1024.png`);
console.log('Generated vector adaptive icon, density PNGs and 1024px export.');
