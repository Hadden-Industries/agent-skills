import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

import {
  pluginPackageDefinition,
  pluginPackageFiles,
} from "./buildPluginPackages.js";

const defaultRepositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Antigravity desktop's documented global plugin layout expects the package
// contents at the extracted root with a minimal `plugin.json` naming it.
const desktopManifestPath = "plugin.json";

// A fixed member timestamp keeps the archive bytes a function of its contents
// alone, so a release archive can be reproduced and compared. ZIP stores DOS
// dates, whose epoch is 1980-01-01: month 1, day 1 in the packed date field.
const dosDate = 33;
const dosTime = 0;

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

// Writes a ZIP archive with deflate compression, one member per file, in
// published-path order. Only the subset of the format that every extractor
// reads is emitted: no data descriptors, no ZIP64, no extra fields.
export function zipArchive(members) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const [path, data] of members) {
    const name = Buffer.from(path, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const header = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(8),
      uint16(dosTime),
      uint16(dosDate),
      uint32(checksum),
      uint32(compressed.length),
      uint32(data.length),
      uint16(name.length),
      uint16(0),
      name,
    ]);

    central.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(8),
        uint16(dosTime),
        uint16(dosDate),
        uint32(checksum),
        uint32(compressed.length),
        uint32(data.length),
        uint16(name.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        name,
      ]),
    );
    local.push(header, compressed);
    offset += header.length + compressed.length;
  }

  const directory = Buffer.concat(central);

  return Buffer.concat([
    ...local,
    directory,
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(members.length),
    uint16(members.length),
    uint32(directory.length),
    uint32(offset),
    uint16(0),
  ]);
}

// Reads back every member of an archive produced by `zipArchive`, so a
// written release archive can be verified against its source bytes.
export function zipMembers(archive) {
  const members = new Map();
  let offset = 0;

  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedLength = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.toString(
      "utf8",
      offset + 30,
      offset + 30 + nameLength,
    );
    const start = offset + 30 + nameLength + extraLength;
    const data = inflateRawSync(
      archive.subarray(start, start + compressedLength),
    );

    if (crc32(data) !== archive.readUInt32LE(offset + 14)) {
      throw new Error(`Archive member ${name} failed its checksum.`);
    }

    members.set(name, data);
    offset = start + compressedLength;
  }

  return members;
}

export function packagePluginArchive({
  skillName,
  outputDirectory,
  repositoryRoot = defaultRepositoryRoot,
}) {
  const definition = pluginPackageDefinition(skillName);
  const { files, manifest } = pluginPackageFiles(definition, repositoryRoot);
  const members = [...files].sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  );

  members.push([
    desktopManifestPath,
    Buffer.from(`${JSON.stringify({ name: manifest.name }, null, 2)}\n`),
  ]);

  const archivePath = join(
    outputDirectory,
    `${manifest.name}-${manifest.version}-antigravity-desktop.zip`,
  );

  if (existsSync(archivePath)) {
    throw new Error(`${archivePath} already exists; it is never overwritten.`);
  }

  const archive = zipArchive(members);

  for (const [path, data] of zipMembers(archive)) {
    const expected = members.find(([member]) => member === path)?.[1];

    if (!expected?.equals(data)) {
      throw new Error(
        `Archive member ${path} does not match its source bytes.`,
      );
    }
  }

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(archivePath, archive);

  return { archivePath, manifest, memberCount: members.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      skill: { type: "string", default: "committing-to-git" },
    },
  });

  if (!values.output || !isAbsolute(values.output)) {
    throw new Error("Supply --output with an absolute directory.");
  }

  const result = packagePluginArchive({
    skillName: values.skill,
    outputDirectory: values.output,
  });

  process.stdout.write(
    `${JSON.stringify({
      archive: result.archivePath,
      name: result.manifest.name,
      version: result.manifest.version,
      members: result.memberCount,
    })}\n`,
  );
}
