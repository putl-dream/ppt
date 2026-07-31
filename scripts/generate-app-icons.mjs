import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const masterSvg = join(root, "build", "icon.svg");
const sizes = [16, 32, 48, 64, 128, 256];

function buildIco(pngBySize) {
  const entries = sizes.map((size) => ({
    size,
    png: pngBySize.get(size),
  }));
  const headerSize = 6 + entries.length * 16;
  let offset = headerSize;
  const parts = [Buffer.alloc(headerSize)];

  parts[0].writeUInt16LE(0, 0); // reserved
  parts[0].writeUInt16LE(1, 2); // type = icon
  parts[0].writeUInt16LE(entries.length, 4);

  entries.forEach((entry, index) => {
    const dirOffset = 6 + index * 16;
    parts[0].writeUInt8(entry.size >= 256 ? 0 : entry.size, dirOffset);
    parts[0].writeUInt8(entry.size >= 256 ? 0 : entry.size, dirOffset + 1);
    parts[0].writeUInt8(0, dirOffset + 2); // color count
    parts[0].writeUInt8(0, dirOffset + 3); // reserved
    parts[0].writeUInt16LE(1, dirOffset + 4); // planes
    parts[0].writeUInt16LE(32, dirOffset + 6); // bit count
    parts[0].writeUInt32LE(entry.png.length, dirOffset + 8);
    parts[0].writeUInt32LE(offset, dirOffset + 12);
    parts.push(entry.png);
    offset += entry.png.length;
  });

  return Buffer.concat(parts);
}

function buildIcns(png256) {
  const type = Buffer.from("ic08");
  const dataSize = 8 + png256.length;
  const totalSize = 8 + dataSize;
  const header = Buffer.alloc(8);
  header.write("icns", 0);
  header.writeUInt32BE(totalSize, 4);
  const entryHeader = Buffer.alloc(8);
  type.copy(entryHeader, 0);
  entryHeader.writeUInt32BE(dataSize, 4);
  return Buffer.concat([header, entryHeader, png256]);
}

async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: Math.max(72, size * 3) })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function main() {
  const svgBuffer = await readFile(masterSvg);
  const pngBySize = new Map();

  for (const size of sizes) {
    pngBySize.set(size, await renderPng(svgBuffer, size));
  }

  const png256 = pngBySize.get(256);
  await mkdir(join(root, "build"), { recursive: true });
  await mkdir(join(root, "src", "renderer", "public"), { recursive: true });

  await writeFile(join(root, "build", "icon.png"), png256);
  await writeFile(join(root, "src", "renderer", "public", "icon.png"), png256);
  await writeFile(join(root, "build", "icon.ico"), buildIco(pngBySize));
  await writeFile(join(root, "build", "icon.icns"), buildIcns(png256));
  await copyFile(masterSvg, join(root, "src", "renderer", "public", "icon.svg"));

  console.log(
    `Generated icons from ${masterSvg}: png/ico/icns + public copies (${sizes.join("/")}px)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
