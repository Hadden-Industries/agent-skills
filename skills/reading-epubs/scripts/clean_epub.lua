-- Strip the EPUB's presentation, keep its meaning.
--
-- Pandoc's EPUB reader preserves two kinds of publisher markup that are noise
-- in Markdown:
--
--   1. Transport wrappers it derives from the source filename --
--      `::: {#chapter-1.xhtml_chapter-1 .section}` and `[]{#chapter-1.xhtml}`.
--   2. The publisher's own styling classes --
--      `[Model_Element]{.CharOverride-2}`, `[ ]{.Heading-Number-Spacing}`.
--
-- Class names are specific to whoever produced the book, so this filter never
-- matches on them. It is handed a map derived from the book's own stylesheet
-- (see scripts/_styles.py) saying which classes carry meaning -- bold, italic,
-- superscript -- and which are purely presentational. Anything not carrying
-- meaning is unwrapped: the text stays, the wrapper goes.
--
-- Nothing is ever deleted along with its content, and no identifier that some
-- link points at is removed. Cleaning must not cost the reader their
-- navigation: a standards document's cross-references are its structure, and
-- an earlier version of this filter silently broke every one of them.

local map_path = os.getenv("READING_EPUBS_STYLE_MAP")
local style_map = {}
local list_markers = {}
local referenced = {}

if map_path then
  local loaded, result = pcall(dofile, map_path)
  if loaded and type(result) == "table" then
    style_map = result.styles or {}
    list_markers = result.list_markers or {}

    -- Seed the referenced set with the table of contents' targets. The
    -- navigation document is not converted, so nothing inside the Markdown
    -- links to these; without seeding them they would be stripped as
    -- unreferenced and the emitted toc.json would address nothing.
    for anchor in pairs(result.toc_anchors or {}) do
      referenced[anchor] = true
    end
  end
end

local SOURCE_EXTENSIONS = { "xhtml", "html", "htm", "xml" }

-- Pandoc names each spine document's wrapper after the file it came from,
-- either as the whole identifier or as a "<filename>_<original-id>" prefix.
local function source_file_id(identifier)
  if not identifier or identifier == "" then
    return false
  end

  for _, extension in ipairs(SOURCE_EXTENSIONS) do
    local pattern = "%." .. extension
    local start, finish = identifier:find(pattern)

    while start do
      -- Require the extension to end the identifier or be followed by the "_"
      -- separator Pandoc inserts, so an identifier merely containing something
      -- like ".htmlish" is left alone.
      local next_character = identifier:sub(finish + 1, finish + 1)

      if next_character == "" or next_character == "_" then
        return true
      end

      start, finish = identifier:find(pattern, finish + 1)
    end
  end

  return false
end

-- Constructors are applied outermost-last so the order in the map reads the
-- way the nesting does.
local CONSTRUCTORS = {
  strong = pandoc.Strong,
  emph = pandoc.Emph,
  smallcaps = pandoc.SmallCaps,
  strikeout = pandoc.Strikeout,
  superscript = pandoc.Superscript,
  subscript = pandoc.Subscript,
}

local function semantics_of(classes)
  local names = {}

  for _, class_name in ipairs(classes) do
    local mapped = style_map[class_name]
    if mapped then
      for _, name in ipairs(mapped) do
        names[#names + 1] = name
      end
    end
  end

  return names
end

local function collect_reference(el)
  if el.target and el.target:sub(1, 1) == "#" then
    referenced[el.target:sub(2)] = true
  end
end

--- True when dropping this element's identifier would dangle a link.
local function is_link_target(identifier)
  return identifier and identifier ~= "" and referenced[identifier]
end

local function apply_semantics(names, content)
  local result = content

  for _, name in ipairs(names) do
    if name == "code" then
      -- Code takes a string, not inlines, so it can only wrap plain text.
      local text = pandoc.utils.stringify(pandoc.Span(result))
      result = { pandoc.Code(text) }
    else
      local constructor = CONSTRUCTORS[name]
      if constructor then
        result = { constructor(result) }
      end
    end
  end

  return result
end

local function clean_span(el)
  local identifier = el.identifier
  local anchored = is_link_target(identifier)

  if #el.content == 0 then
    -- An empty span is an anchor. Keep it only if something links to it.
    if anchored then
      return nil
    end
    if source_file_id(identifier) then
      return {}
    end
    return nil
  end

  local names = semantics_of(el.classes)
  local rebuilt = apply_semantics(names, el.content)

  if anchored then
    -- Preserve the identifier, discard the classes: the styling has become
    -- real Markdown, but the link still needs somewhere to land.
    return pandoc.Span(rebuilt, pandoc.Attr(identifier, {}, {}))
  end

  return rebuilt
end

local function clean_div(el)
  if is_link_target(el.identifier) then
    return nil
  end

  if source_file_id(el.identifier) then
    return el.content
  end

  -- A div whose classes carry no meaning is layout. Unwrap it.
  if #el.classes > 0 and #semantics_of(el.classes) == 0 then
    return el.content
  end

  if #el.classes == 0 and (not el.identifier or el.identifier == "") then
    return el.content
  end
end

-- Some publishers set bulleted lists as ordinary paragraphs that begin with a
-- dash, with no <ul> or <li> anywhere in the source. Pandoc reproduces that
-- faithfully, so the list arrives as a run of paragraphs and its structure is
-- lost to a reader.
--
-- Reconstructing it is only safe with a second signal, because a paragraph
-- opening with a dash is also how Russian and French prose sets dialogue, and
-- a rule keyed on the glyph alone would turn half a novel into a bullet list.
-- That signal is the hanging indent: a list outdents its marker (negative
-- text-indent) where prose indents its first line. The stylesheet knows which
-- is which, and `_styles.py` resolves it into the set of marker span classes
-- below. It is empty unless the book genuinely sets dash lists that way, so
-- fiction is untouched.
local DASH_GLYPHS = { ["\u{2014}"] = true, ["\u{2013}"] = true, ["\u{2015}"] = true }

--- Returns the item's inlines when this block is a dash bullet, else nil.
local function dash_item_content(block)
  if block.t ~= "Para" or #block.content < 3 then
    return nil
  end

  local first = block.content[1]
  if first.t ~= "Str" or not DASH_GLYPHS[first.text] then
    return nil
  end

  local marker = block.content[2]
  if marker.t ~= "Span" then
    return nil
  end

  local matched = false
  for _, class_name in ipairs(marker.classes) do
    if list_markers[class_name] then
      matched = true
      break
    end
  end

  if not matched then
    return nil
  end

  local rest = {}
  for index = 3, #block.content do
    rest[#rest + 1] = block.content[index]
  end

  -- Drop any whitespace left over from the marker.
  while rest[1] and (rest[1].t == "Space" or rest[1].t == "SoftBreak") do
    table.remove(rest, 1)
  end

  if #rest == 0 then
    return nil
  end

  return rest
end

local function group_dash_lists(blocks)
  local result = pandoc.Blocks({})
  local items = nil

  local function flush()
    if items then
      result:insert(pandoc.BulletList(items))
      items = nil
    end
  end

  for _, block in ipairs(blocks) do
    local content = dash_item_content(block)

    if content then
      items = items or {}
      items[#items + 1] = pandoc.Blocks({ pandoc.Plain(content) })
    else
      flush()
      result:insert(block)
    end
  end

  flush()

  return result
end

-- Several elements carry the publisher's classes without those classes ever
-- meaning anything: `## Heading {.Heading-5}`, `[text](url){.calibre7}`. The
-- element type already conveys the structure, so the classes are pure styling.
-- Strip them, but keep the identifier, which a link may point at.
local function strip_classes(el)
  if #el.classes == 0 then
    return nil
  end

  el.classes = {}

  return el
end

local function clean_link(el)
  return strip_classes(el)
end

-- Code blocks need the opposite treatment to everything else here.
--
-- Pandoc's Markdown writer emits an indented code block whenever a CodeBlock
-- carries no attributes, and there is no writer setting that overrides this.
-- Stripping the class therefore does not just lose the language: it loses the
-- fence, leaving code that an extractor has to de-indent and that carries no
-- delimiter at all. A non-empty attribute is the only way to guarantee ``` .
--
-- So the class stays, but it must not be the publisher's styling leaking into
-- an info string that conventionally names a language. The stylesheet settles
-- which is which: a class the book styles is presentation, a class it does not
-- style is almost always a language identifier, since Pandoc has already
-- normalised `language-python` and `sourceCode python` down to `python`.
local FALLBACK_LANGUAGE = "text"

-- Checked before the stylesheet, so that a syntax-highlighting theme defining
-- `.python` cannot demote a genuine language to plain text.
local KNOWN_LANGUAGES = {
  bash = true, c = true, cpp = true, csharp = true, css = true, diff = true,
  go = true, haskell = true, html = true, ini = true, java = true,
  javascript = true, json = true, kotlin = true, lua = true, makefile = true,
  markdown = true, matlab = true, objectivec = true, perl = true, php = true,
  powershell = true, python = true, r = true, ruby = true, rust = true,
  scala = true, sh = true, shell = true, sql = true, swift = true,
  toml = true, typescript = true, xml = true, yaml = true,
}

-- Marker classes that Pandoc and syntax highlighters attach alongside the real
-- language. They are never languages themselves, and an unstyled one would
-- otherwise be mistaken for one by the fallback below.
local NON_LANGUAGE_CLASSES = {
  code = true, hljs = true, highlight = true, lineanchors = true,
  numberlines = true, pre = true, prettyprint = true, sourcecode = true,
  verbatim = true,
}

local function code_language(classes)
  for _, class_name in ipairs(classes) do
    if KNOWN_LANGUAGES[class_name:lower()] then
      return class_name:lower()
    end
  end

  for _, class_name in ipairs(classes) do
    local lowered = class_name:lower()
    if not NON_LANGUAGE_CLASSES[lowered] and style_map[class_name] == nil then
      return class_name
    end
  end

  return FALLBACK_LANGUAGE
end

local function sniff_language(text)
  local trimmed = text:match("^%s*(.-)%s*$") or ""

  while true do
    local rest = trimmed:match("^<!%-%-.-%-%->%s*(.*)$")
    if not rest then
      break
    end
    trimmed = rest
  end

  if trimmed == "" then
    return nil
  end

  if trimmed:match("^<%?xml") then
    return "xml"
  end

  local lowered = trimmed:lower()
  if lowered:match("^<!doctype%s+html") or lowered:match("^<html[%s>]") then
    return "html"
  end

  -- An opening tag alone is not enough, because grammar notation has the same
  -- shape:
  --
  --     <relation assign>
  --              ::=   <relvar name> := <relation exp>
  --
  -- That is BNF, and a book on relational theory is full of it. Real markup
  -- either closes a tag or carries a quoted attribute, and requiring one of
  -- those separates the two without special-casing either.
  if trimmed:match("^<%a[%w:%-%.]*[%s>/]") then
    local closes = trimmed:match("</%a") or trimmed:find("/>", 1, true)
    local has_attribute = trimmed:match("=%s*\"") or trimmed:match("=%s*'")

    if closes or has_attribute then
      return "xml"
    end
  end

  return nil
end

local function clean_code_block(el)
  local identifier = is_link_target(el.identifier) and el.identifier or ""
  local language = code_language(el.classes)

  if language == FALLBACK_LANGUAGE then
    language = sniff_language(el.text) or FALLBACK_LANGUAGE
  end

  el.attr = pandoc.Attr(identifier, { language }, {})

  return el
end

return {
  { Link = collect_reference },
  -- Must precede the span pass: the marker span identifying a dash bullet is
  -- presentational, so that pass would unwrap the evidence.
  { Blocks = group_dash_lists },
  {
    Span = clean_span,
    Div = clean_div,
    Header = strip_classes,
    Table = strip_classes,
    Link = clean_link,
    Image = strip_classes,
    CodeBlock = clean_code_block,
  },
}
