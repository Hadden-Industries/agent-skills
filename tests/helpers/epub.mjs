/**
 * Builds EPUB fixtures for the `reading-epubs` contract tests.
 *
 * The fixtures are generated rather than committed as binaries so that their
 * contents stay reviewable in a diff and a test can vary them. That requires
 * writing a ZIP container, and Node's standard library has a compressor but no
 * archive writer, so a minimal STORED-only writer lives here.
 *
 * Entries are deflated exactly as a real EPUB's are, apart from the leading
 * `mimetype` entry the container format requires to be stored uncompressed.
 * Keeping the writer dependency-free preserves the repository's position of
 * needing no `package.json`, no lockfile, and no third-party package to run
 * its tests.
 */

import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const STORED = 0;
const DEFLATED = 8;
const VERSION_STORED = 10;
const VERSION_DEFLATED = 20;
const VERSION_MADE_BY = 20;

// A fixed 1980-01-01 DOS timestamp keeps generated archives byte-for-byte
// reproducible. DOS dates cannot express a zero day or month, so the epoch
// itself is the lowest legal value.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Serialises `entries` (an array of `{ name, contents }`) into a ZIP archive.
 * Entry order is preserved, which matters because EPUB requires `mimetype`
 * first.
 */
export function buildZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const { name, contents } of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
    const crc = crc32(data);

    // The EPUB container format requires `mimetype` to be stored uncompressed.
    // Everything else is deflated, because that is what real EPUBs do and it
    // is what makes their text unreadable without a conversion step. A fixture
    // that stored its chapters in plain text would be readable straight out of
    // the archive, and would quietly misrepresent what this skill is for.
    const stored = name === "mimetype";
    const body = stored ? data : deflateRawSync(data, { level: 9 });
    const method = stored ? STORED : DEFLATED;
    const version = stored ? VERSION_STORED : VERSION_DEFLATED;

    const local = Buffer.alloc(30);

    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    localChunks.push(local, nameBuffer, body);

    const central = Buffer.alloc(46);

    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralChunks.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + body.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, end]);
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const contentOpf = (extension) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:reading-epubs-fixture</dc:identifier>
    <dc:title>Reading EPUBs Fixture</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">1980-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="chapter-1" href="chapter-1.${extension}" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter-2.${extension}" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2"/>
  </spine>
</package>
`;

const navXhtml = (extension) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter-1.${extension}">The First Chapter</a></li>
        <li><a href="chapter-2.${extension}">The Second Chapter</a></li>
      </ol>
    </nav>
  </body>
</html>
`;

// Producers wrap chapter content differently, and Pandoc carries the wrapper
// through to the class it puts on the generated Div. A `<section>` becomes
// `.section`; a publisher's own `<div class="...">` keeps that class instead.
// Adobe InDesign's `_idContainer` identifiers are one common real example.
const WRAPPERS = {
  section: (number) => [`<section id="chapter-${number}">`, "</section>"],
  div: (number) => [`<div class="MainContent" id="_idContainer00${number}">`, "</div>"],
};

function chapter(number, title, paragraph, wrapper, extra = "") {
  const [open, close] = WRAPPERS[wrapper](number);

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
  <body>
    ${open}
      <h1>${title}</h1>
      <p>${paragraph}</p>
      ${extra}
    ${close}
  </body>
</html>
`;
}

/**
 * A small but structurally complete EPUB 3 container. The two chapters carry
 * distinctive prose so a conversion test can assert that author content
 * survived, and the `<section>` wrappers exercise `clean_epub.lua`.
 *
 * Two knobs reproduce the shapes real EPUBs take, because Pandoc's generated
 * identifiers and classes follow both:
 *
 * - `extension` sets the spine documents' file extension. Modern producers emit
 *   `.xhtml`, but older ones and anything Feedbooks produced use `.xml`.
 * - `wrapper` sets the element enclosing each chapter, which decides the class
 *   Pandoc puts on the generated Div — `section` for `<section>`, or a
 *   publisher's own class for a `<div>`.
 *
 * Every combination has to survive conversion without leaking transport
 * structure into the text an agent reads.
 *
 * `crossLink` adds an internal cross-reference between the two chapters. Real
 * books use these heavily — a table of contents is nothing else — and the
 * anchor they point at looks exactly like the transport noise a cleaning pass
 * wants to delete, so it is the case most easily broken by over-cleaning.
 *
 * `css` and `markup` drive the style-stripping tests: `css` becomes the book's
 * stylesheet, and `markup` is raw XHTML appended to the first chapter, so a
 * test can define a class and then use it.
 */
export function buildEpub({
  extension = "xhtml",
  wrapper = "section",
  crossLink = false,
  css = "",
  markup = "",
} = {}) {
  const [firstExtra, secondExtra] = crossLink
    ? [
        `<p><a href="chapter-2.${extension}#deep-anchor">See the second chapter</a></p>`,
        `<p><a id="deep-anchor"></a>The cross-referenced passage.</p>`,
      ]
    : ["", ""];

  return buildZip([
    // The EPUB container format requires `mimetype` to be the first entry and
    // to be stored uncompressed.
    { name: "mimetype", contents: "application/epub+zip" },
    { name: "META-INF/container.xml", contents: CONTAINER_XML },
    { name: "OEBPS/content.opf", contents: contentOpf(extension) },
    { name: "OEBPS/nav.xhtml", contents: navXhtml(extension) },
    { name: "OEBPS/style.css", contents: css || "p { margin: 0; }\n" },
    {
      name: `OEBPS/chapter-1.${extension}`,
      contents: chapter(
        1,
        "The First Chapter",
        "Distinctive prose about eventual consistency.",
        wrapper,
        firstExtra + markup,
      ),
    },
    {
      name: `OEBPS/chapter-2.${extension}`,
      contents: chapter(
        2,
        "The Second Chapter",
        "Further prose about quorum reads.",
        wrapper,
        secondExtra,
      ),
    },
  ]);
}

/**
 * A well-formed ZIP archive that is not an EPUB, because it has no
 * `META-INF/container.xml`. This separates the converter's two input checks:
 * "is this a ZIP" and "is this ZIP an EPUB container".
 */
export function buildZipWithoutContainer() {
  return buildZip([{ name: "readme.txt", contents: "Not an EPUB.\n" }]);
}
