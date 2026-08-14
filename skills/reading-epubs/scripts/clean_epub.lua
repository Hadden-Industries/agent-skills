-- Remove transport-only wrappers introduced by Pandoc's EPUB reader while
-- retaining author content. This intentionally targets only identifiers that
-- expose an EPUB XHTML/HTML source filename.

local function source_file_id(identifier)
  if not identifier or identifier == "" then
    return false
  end
  return identifier:find("%.xhtml", 1, false)
      or identifier:find("%.html", 1, false)
      or identifier:find("%.htm", 1, false)
end

local function has_class(classes, wanted)
  for _, class_name in ipairs(classes) do
    if class_name == wanted then
      return true
    end
  end
  return false
end

function Div(el)
  if has_class(el.classes, "section") and source_file_id(el.identifier) then
    return el.content
  end
end

function Span(el)
  if #el.content == 0 and source_file_id(el.identifier) then
    return {}
  end
end
