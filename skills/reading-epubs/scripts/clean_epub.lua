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

if map_path then
  local loaded, result = pcall(dofile, map_path)
  if loaded and type(result) == "table" then
    style_map = result.styles or {}
    list_markers = result.list_markers or {}
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

local referenced = {}

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
    CodeBlock = strip_classes,
  },
}
