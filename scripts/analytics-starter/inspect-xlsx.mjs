// Bounded read-only inspection of the checked-in starter, not a general upload parser.
import { inflateRawSync } from "node:zlib";

export function xlsxParts(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Missing XLSX central directory");
  const parts = new Map();
  let offset = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid XLSX entry");
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + size);
    if (![0, 8].includes(method)) throw new Error("Unsupported XLSX compression");
    parts.set(name, (method === 8 ? inflateRawSync(compressed) : compressed).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

const decode = (value) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const unprefix = (value) => value.replace(/(<\/?)[A-Za-z_][\w.-]*:/g, "$1");
export function sheetCells(parts, number) {
  const strings = [...unprefix(parts.get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(
    (match) => decode([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join("")),
  );
  const cells = new Map();
  for (const match of unprefix(parts.get(`xl/worksheets/sheet${number}.xml`)).matchAll(
    /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
  )) {
    const body = match[2] ?? "";
    const address = /\br="([^"]+)"/.exec(match[1])?.[1];
    const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
    const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join("");
    const value = /\bt="s"/.test(match[1]) ? strings[Number(raw)] : decode(raw ?? inline);
    cells.set(address, { value, formula: formula ? decode(formula) : null });
  }
  return cells;
}
