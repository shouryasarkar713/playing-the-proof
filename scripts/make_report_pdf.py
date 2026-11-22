#!/usr/bin/env python3
"""Render docs/PROJECT_REPORT.md to docs/PROJECT_REPORT.pdf.

Usage (from the repository root):  python -I scripts/make_report_pdf.py

Requires PyMuPDF (import name `pymupdf`). The script is deterministic and
re-runnable: it reads the Markdown file, converts a small Markdown subset
(headings, paragraphs, lists, tables, fenced code, figures, bold/italic/code,
links) and LaTeX-style math ($...$ and $$...$$, rendered as styled Unicode text)
to HTML, lays it out with PyMuPDF's Story engine, and adds a title page, a table
of contents with page numbers, PDF bookmarks and page numbers.

Figures are read from docs/figures/. SVG figures are rasterised first. A figure
file that does not exist is replaced by a labelled placeholder box. Any
unresolved {{PLACEHOLDER}} token is highlighted in the PDF and listed on stderr.
"""
import html
import os
import re
import shutil
import sys
import tempfile

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
DOCS = os.path.join(REPO, "docs")
SRC = os.path.join(DOCS, "PROJECT_REPORT.md")
OUT = os.path.join(DOCS, "PROJECT_REPORT.pdf")

PAGE = pymupdf.paper_rect("a4")
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 62, 64, 64
BODY_RECT = pymupdf.Rect(MARGIN_X, MARGIN_TOP, PAGE.width - MARGIN_X, PAGE.height - MARGIN_BOTTOM)
TEXT_WIDTH = BODY_RECT.width
MAX_FIG_HEIGHT = 400

CSS = """
body { font-family: serif; font-size: 10.2pt; line-height: 1.38; color: #1a1a1a; }
p { margin-top: 0; margin-bottom: 6pt; text-align: justify; }
h1 { font-family: sans-serif; font-size: 20pt; line-height: 1.2; margin-top: 0; margin-bottom: 8pt; }
h2 { font-family: sans-serif; font-size: 14.5pt; margin-top: 18pt; margin-bottom: 6pt; color: #12305a;
     border-bottom: 0.6pt solid #9aa9c2; padding-bottom: 2pt; }
h3 { font-family: sans-serif; font-size: 11.6pt; margin-top: 12pt; margin-bottom: 4pt; color: #1d3a66; }
ul, ol { margin-top: 0; margin-bottom: 6pt; }
li { margin-bottom: 2pt; text-align: justify; }
code { font-family: monospace; font-size: 8.8pt; background-color: #eef0f3; }
pre { font-family: monospace; font-size: 8.2pt; line-height: 1.3; background-color: #f1f3f6;
      padding: 5pt; margin-top: 2pt; margin-bottom: 8pt; }
table { margin-top: 3pt; margin-bottom: 9pt; font-family: sans-serif; font-size: 8.4pt; line-height: 1.25; }
th { background-color: #dfe6f1; border: 0.5pt solid #8f9bb0; padding: 3pt; text-align: left; font-weight: bold; }
td { border: 0.5pt solid #b6bdca; padding: 3pt; text-align: left; vertical-align: top; }
p.eq { text-align: center; margin-top: 4pt; margin-bottom: 8pt; font-size: 10.8pt; }
div.fig { margin-top: 6pt; margin-bottom: 8pt; text-align: center; }
p.cap { font-family: sans-serif; font-size: 8.6pt; line-height: 1.3; text-align: left; color: #333333;
        margin-top: 3pt; margin-bottom: 8pt; }
p.missing { font-family: sans-serif; font-size: 9pt; color: #7a1f1f; background-color: #f6e6e6;
            border: 0.6pt dashed #a33; padding: 18pt; text-align: center; }
span.ph { background-color: #ffe98a; }
p.meta { font-family: sans-serif; font-size: 11.5pt; margin-bottom: 7pt; text-align: center; }
p.tag { font-size: 11pt; text-align: center; font-style: italic; margin-top: 26pt; }
p.toc1 { font-family: sans-serif; font-size: 10pt; margin-top: 5pt; margin-bottom: 1pt; font-weight: bold; text-align: left; }
p.toc2 { font-family: sans-serif; font-size: 9.2pt; margin-top: 0; margin-bottom: 0; margin-left: 16pt; text-align: left; }
"""

PLACEHOLDERS = []

# ----------------------------------------------------------------- LaTeX-ish math

SYMBOLS = {
    "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥", "ne": "≠", "neq": "≠",
    "in": "∈", "cap": "∩", "cup": "∪", "emptyset": "∅", "partial": "∂",
    "to": "→", "Rightarrow": "⇒", "sum": "∑", "cdot": "·", "times": "×",
    "dots": "…", "ldots": "…", "pm": "±", "subset": "⊂", "subseteq": "⊆",
    "setminus": "∖", "ell": "ℓ", "lambda": "λ", "varepsilon": "ε", "epsilon": "ε",
    "delta": "δ", "alpha": "α", "pi": "π", "lceil": "⌈", "rceil": "⌉",
    "lfloor": "⌊", "rfloor": "⌋", "infty": "∞", "forall": "∀", "ge": "≥",
}
BB = {"R": "ℝ", "Z": "ℤ", "N": "ℕ", "Q": "ℚ"}
RELATIONS = set("=≤≥≠<>∈⊂⊆→⇒")
SPACE_CMDS = {",": " ", ";": " ", ":": " ", "!": "", " ": " ", "quad": " ", "qquad": "  "}
STRIP_CMDS = {"big", "Big", "bigg", "Bigg", "left", "right", "displaystyle"}


class TexParser:
    def __init__(self, s):
        self.s = s
        self.i = 0

    def peek(self):
        return self.s[self.i] if self.i < len(self.s) else ""

    def skip_ws(self):
        while self.peek() == " ":
            self.i += 1

    def group_or_token(self):
        """One TeX argument: {...} or a single token."""
        self.skip_ws()
        c = self.peek()
        if c == "{":
            self.i += 1
            depth, start = 1, self.i
            while self.i < len(self.s) and depth:
                if self.s[self.i] == "{":
                    depth += 1
                elif self.s[self.i] == "}":
                    depth -= 1
                self.i += 1
            inner = self.s[start:self.i - 1]
            return TexParser(inner).parse()
        if c == "\\":
            return self.atom()
        if c == "":
            return ""
        self.i += 1
        return self.render_char(c)

    def raw_group(self):
        self.skip_ws()
        if self.peek() != "{":
            c = self.peek()
            self.i += 1
            return c
        self.i += 1
        depth, start = 1, self.i
        while self.i < len(self.s) and depth:
            if self.s[self.i] == "{":
                depth += 1
            elif self.s[self.i] == "}":
                depth -= 1
            self.i += 1
        return self.s[start:self.i - 1]

    @staticmethod
    def render_char(c):
        if c == "-":
            return "−"
        if c in RELATIONS:
            return " " + html.escape(c) + " "
        if c == "+":
            return " + "
        if c == ",":
            return ", "
        if c.isalpha() and c.isascii():
            return "<i>" + c + "</i>"
        return html.escape(c)

    def atom(self):
        c = self.peek()
        if c != "\\":
            self.i += 1
            return self.render_char(c)
        self.i += 1
        # command
        m = re.match(r"[A-Za-z]+", self.s[self.i:])
        if not m:
            ch = self.peek()
            self.i += 1
            return SPACE_CMDS.get(ch, html.escape(ch))
        name = m.group(0)
        self.i += len(name)
        if name in STRIP_CMDS:
            return ""
        if name in SPACE_CMDS:
            return SPACE_CMDS[name]
        if name in ("frac", "tfrac", "dfrac"):
            a = self.group_or_token()
            b = self.group_or_token()
            return self.fraction(a, b)
        if name == "binom":
            a = self.group_or_token()
            b = self.group_or_token()
            return "<i>C</i>(" + a + ", " + b + ")"
        if name in ("operatorname", "mathrm", "text", "mathit"):
            t = self.raw_group()
            return html.escape(re.sub(r"\\(.)", r"\1", t))
        if name == "mathbb":
            t = self.raw_group()
            return BB.get(t, html.escape(t))
        if name == "vec":
            t = self.group_or_token()
            return t + "⃗"
        if name in SYMBOLS:
            sym = SYMBOLS[name]
            if sym in RELATIONS:
                return " " + sym + " "
            if sym in ("±", "×"):
                return " " + sym + " "
            return sym
        return html.escape(name)

    @staticmethod
    def fraction(a, b):
        def plain(t):
            return re.sub(r"<[^>]+>", "", t)

        def atomic(t):
            # a single token, or a parenthesised group (optionally with a script)
            core = re.sub(r"<su[bp]>.*?</su[bp]>", "", t)
            p = plain(core)
            if re.fullmatch(r"[A-Za-z0-9.]+", p):
                return True
            if p.startswith("(") and p.endswith(")"):
                depth = 0
                for idx, ch in enumerate(p):
                    depth += (ch == "(") - (ch == ")")
                    if depth == 0 and idx < len(p) - 1:
                        return False
                return True
            return False

        def wrap(t):
            return t if atomic(t) else "(" + t + ")"

        return wrap(a) + "⁄" + wrap(b) + " "

    def parse(self):
        out = []
        while self.i < len(self.s):
            c = self.peek()
            if c in "^_":
                self.i += 1
                arg = self.group_or_token()
                tag = "sup" if c == "^" else "sub"
                out.append("<%s>%s</%s>" % (tag, arg, tag))
            elif c == "{":
                out.append(self.group_or_token())
            elif c == "}":
                self.i += 1
            elif c == " ":
                self.i += 1
            else:
                out.append(self.atom())
        return "".join(out)


def tex(s):
    s = s.strip()
    if s.startswith("\\begin"):
        return html.escape(s)
    return TexParser(s).parse()


# ----------------------------------------------------------------- inline Markdown

def inline(text):
    """Convert inline Markdown (code, math, bold, italic, links) to HTML."""
    tokens = []

    def stash(h):
        tokens.append(h)
        return "\x00%d\x00" % (len(tokens) - 1)

    text = re.sub(r"`([^`]+)`", lambda m: stash("<code>%s</code>" % html.escape(m.group(1))), text)
    text = re.sub(r"(?<!\\)\$([^$\n]+?)(?<!\\)\$", lambda m: stash("<span>%s</span>" % tex(m.group(1))), text)
    text = html.escape(text, quote=False)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", lambda m: '<a href="%s">%s</a>' % (m.group(2), m.group(1)), text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", text)

    def ph(m):
        PLACEHOLDERS.append(m.group(0))
        return '<span class="ph">%s</span>' % m.group(0)

    text = re.sub(r"\{\{[A-Z0-9_]+\}\}", ph, text)
    text = re.sub(r"\x00(\d+)\x00", lambda m: tokens[int(m.group(1))], text)
    # placeholders inside code spans / math are highlighted as well
    text = re.sub(r"(?<!>)\{\{[A-Z0-9_]+\}\}(?!</span>)", lambda m: ph(m), text)
    return text


# ----------------------------------------------------------------- block parsing

def split_row(line):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    cells, cur, in_code, in_math = [], [], False, False
    for ch in line:
        if ch == "`":
            in_code = not in_code
        elif ch == "$" and not in_code:
            in_math = not in_math
        if ch == "|" and not in_code and not in_math:
            cells.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    cells.append("".join(cur).strip())
    return cells


class Block:
    def __init__(self, kind, **kw):
        self.kind = kind
        self.__dict__.update(kw)


def parse_markdown(md):
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S)
    lines = md.split("\n")
    blocks, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            code = []
            i += 1
            while i < n and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            blocks.append(Block("code", text="\n".join(code)))
            continue
        if line.strip() == "---":
            blocks.append(Block("rule"))
            i += 1
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            blocks.append(Block("h", level=len(m.group(1)), text=m.group(2).strip()))
            i += 1
            continue
        if line.strip().startswith("$$"):
            body = line.strip()[2:]
            if body.endswith("$$") and len(body) > 2:
                body = body[:-2]
                i += 1
            else:
                parts = [body] if body else []
                i += 1
                while i < n and "$$" not in lines[i]:
                    parts.append(lines[i])
                    i += 1
                if i < n:
                    tail = lines[i].split("$$")[0]
                    if tail.strip():
                        parts.append(tail)
                    i += 1
                body = " ".join(parts)
            blocks.append(Block("eq", text=body.strip()))
            continue
        m = re.match(r"^!\[(.*)\]\((.+?)\)\s*$", line.strip())
        if m:
            blocks.append(Block("img", alt=m.group(1), path=m.group(2)))
            i += 1
            continue
        if line.lstrip().startswith("|"):
            rows = []
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            header, body = rows[0], [r for r in rows[2:]]
            blocks.append(Block("table", header=header, rows=body))
            continue
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if m:
            ordered = m.group(2)[0].isdigit()
            items = []
            while i < n:
                mm = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[i])
                if mm:
                    items.append(mm.group(3))
                    i += 1
                elif lines[i].startswith("  ") and lines[i].strip() and items:
                    items[-1] += " " + lines[i].strip()
                    i += 1
                else:
                    break
            blocks.append(Block("list", ordered=ordered, items=items))
            continue
        para = [line.strip()]
        i += 1
        while i < n and lines[i].strip() and not re.match(r"^(#{1,3}\s|```|\||!\[|\s*([-*]|\d+\.)\s|\$\$|---\s*$)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        blocks.append(Block("p", text=" ".join(para)))
    return blocks


# ----------------------------------------------------------------- HTML generation

def prepare_images(blocks, tmp):
    """Copy/rasterise figures into tmp; returns {original path: file name or None}."""
    mapping = {}
    for b in blocks:
        if b.kind != "img":
            continue
        src = os.path.normpath(os.path.join(DOCS, b.path))
        base = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.basename(src))
        if not os.path.isfile(src):
            print("warning: figure not found: %s" % b.path, file=sys.stderr)
            mapping[b.path] = None
            continue
        if src.lower().endswith(".svg"):
            doc = pymupdf.open(src)
            pdf = pymupdf.open("pdf", doc.convert_to_pdf())
            pix = pdf[0].get_pixmap(dpi=200)
            base = os.path.splitext(base)[0] + ".png"
            pix.save(os.path.join(tmp, base))
        else:
            shutil.copyfile(src, os.path.join(tmp, base))
        mapping[b.path] = base
    return mapping


def image_size(path):
    pix = pymupdf.Pixmap(path)
    return pix.width, pix.height


def block_html(b, tmp, imgmap):
    if b.kind == "h":
        return "<h%d>%s</h%d>" % (b.level, inline(b.text), b.level)
    if b.kind == "p":
        return "<p>%s</p>" % inline(b.text)
    if b.kind == "eq":
        return '<p class="eq">%s</p>' % tex(b.text)
    if b.kind == "code":
        return "<pre>%s</pre>" % html.escape(b.text)
    if b.kind == "rule":
        return ""
    if b.kind == "list":
        tag = "ol" if b.ordered else "ul"
        return "<%s>%s</%s>" % (tag, "".join("<li>%s</li>" % inline(x) for x in b.items), tag)
    if b.kind == "table":
        ncol = len(b.header)
        head = "".join("<th>%s</th>" % inline(c) for c in b.header)
        rows = []
        for r in b.rows:
            r = (r + [""] * ncol)[:ncol]
            rows.append("<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r))
        return "<table width=\"100%%\"><tr>%s</tr>%s</table>" % (head, "".join(rows))
    if b.kind == "img":
        cap = '<p class="cap">%s</p>' % inline(b.alt)
        name = imgmap.get(b.path)
        if name is None:
            return '<div class="fig"><p class="missing">Figure file not available: %s</p>%s</div>' % (html.escape(b.path), cap)
        w, h = image_size(os.path.join(tmp, name))
        width = min(TEXT_WIDTH, 470.0)
        if width * h / w > MAX_FIG_HEIGHT:
            width = MAX_FIG_HEIGHT * w / h
        return '<div class="fig"><img src="%s" width="%d"/>%s</div>' % (name, int(width), cap)
    raise ValueError(b.kind)


def render_story(html_text, archive_dir, rect_fn, writer_path=None):
    """Lay out `html_text`; returns (path of the PDF written, [(level, text, page_no)])."""
    arch = pymupdf.Archive(archive_dir) if archive_dir else None
    story = pymupdf.Story(html=html_text, user_css=CSS, archive=arch)
    positions = []
    path = writer_path
    writer = pymupdf.DocumentWriter(path)
    pno = 0
    more = True
    while more:
        pno += 1
        dev = writer.begin_page(PAGE)
        more, _ = story.place(rect_fn(pno))
        def record(p):
            if p.heading and (p.open_close & 1):
                positions.append((p.heading, p.text, p.page))

        story.element_positions(record, {"page": pno})
        story.draw(dev)
        writer.end_page()
    writer.close()
    return positions, pno


# ----------------------------------------------------------------- assembly

def title_page_html(blocks):
    title = next(b for b in blocks if b.kind == "h" and b.level == 1).text
    meta, tagline = [], ""
    i = blocks.index(next(b for b in blocks if b.kind == "h" and b.level == 1)) + 1
    while i < len(blocks) and blocks[i].kind != "rule":
        b = blocks[i]
        if b.kind == "list":
            for it in b.items:
                m = re.match(r"\*\*(.+?):\*\*\s*(.*)", it)
                if m:
                    meta.append((m.group(1), m.group(2)))
        elif b.kind == "p" and b.text.startswith("*"):
            tagline = b.text.strip("*")
        i += 1
    parts = ['<p style="margin-top:110pt"></p>', "<h1 style=\"text-align:center;font-size:24pt\">%s</h1>" % inline(title)]
    parts.append('<p class="tag">%s</p>' % inline(tagline) if tagline else "")
    parts.append('<p style="margin-top:46pt"></p>')
    for k, v in meta:
        parts.append('<p class="meta"><b>%s</b><br/>%s</p>' % (html.escape(k), inline(v)))
    parts.append('<p class="meta" style="margin-top:36pt;font-size:10pt;color:#555">Technical report</p>')
    return "<html><body>%s</body></html>" % "".join(parts), title, i


def toc_html(entries):
    rows = []
    for level, text, page in entries:
        cls = "toc1" if level == 2 else "toc2"
        label = html.escape(re.sub(r"[`*$]", "", text))
        rows.append(
            '<p class="%s"><span>%s</span> <span style="color:#555">&#8230;&#8230; %s</span></p>' % (cls, label, page)
        )
    return "<html><body><h2 style=\"margin-top:0\">Contents</h2>%s</body></html>" % "".join(rows)


def main():
    if not os.path.isfile(SRC):
        sys.exit("missing %s" % SRC)
    with open(SRC, encoding="utf8") as f:
        md = f.read()
    blocks = parse_markdown(md)
    tmp = tempfile.mkdtemp(prefix="ptp_report_")
    try:
        imgmap = prepare_images(blocks, tmp)
        title_html, title, start = title_page_html(blocks)
        body_blocks = blocks[start:]
        body_html = "<html><body>%s</body></html>" % "".join(block_html(b, tmp, imgmap) for b in body_blocks)
        # reset after body conversion so each placeholder is listed once per use in the body only
        body_rect = lambda pno: BODY_RECT

        # Pass A: body layout (page numbers relative to the body)
        body_pdf = os.path.join(tmp, "body.pdf")
        positions, body_pages = render_story(body_html, tmp, body_rect, body_pdf)
        heads = [(b.level, b.text) for b in body_blocks if b.kind == "h" and b.level in (2, 3)]
        found = [(lvl, pg) for (lvl, _txt, pg) in positions if lvl in (2, 3)]
        if len(found) != len(heads):
            sys.exit("heading count mismatch: layout reported %d, document has %d" % (len(found), len(heads)))
        entries = [(h[0], h[1], pg) for h, (_lvl, pg) in zip(heads, found)]

        # Table of contents: render once with dummy numbers to learn its page count, then again.
        toc_pdf = os.path.join(tmp, "toc.pdf")
        _, toc_pages = render_story(toc_html([(l, t, 999) for l, t, _ in entries]), tmp, body_rect, toc_pdf)
        front = 1 + toc_pages
        final_entries = [(l, t, pg + front) for l, t, pg in entries]
        render_story(toc_html(final_entries), tmp, body_rect, toc_pdf)

        title_pdf = os.path.join(tmp, "title.pdf")
        render_story(title_html, tmp, lambda pno: BODY_RECT, title_pdf)

        doc = pymupdf.open()
        for part in (title_pdf, toc_pdf, body_pdf):
            with pymupdf.open(part) as p:
                doc.insert_pdf(p)

        # Footers: page number (not on the title page) and a running head.
        for i, page in enumerate(doc):
            if i == 0:
                continue
            rect = page.rect
            page.insert_text(
                (rect.width / 2 - 6, rect.height - 34), str(i + 1), fontname="helv", fontsize=9, color=(0.3, 0.3, 0.3)
            )
            page.insert_text(
                (MARGIN_X, 38), "Playing the Proof", fontname="helv", fontsize=8, color=(0.45, 0.45, 0.45)
            )
            page.draw_line((MARGIN_X, 43), (rect.width - MARGIN_X, 43), color=(0.75, 0.75, 0.75), width=0.5)

        # Bookmarks
        toc = [[1 if l == 2 else 2, re.sub(r"[`*$]", "", t), pg] for l, t, pg in final_entries]
        if toc and toc[0][0] != 1:
            toc[0][0] = 1
        doc.set_toc(toc)
        doc.set_metadata(
            {
                "title": re.sub(r"[`*]", "", title),
                "author": "Shourya Sarkar",
                "subject": "Scientific Visualization project report",
                "creationDate": "D:20261121000000",
                "modDate": "D:20261121000000",
                "producer": "PyMuPDF",
                "creator": "scripts/make_report_pdf.py",
            }
        )
        try:
            doc.subset_fonts()
        except Exception:
            pass
        doc.save(OUT, garbage=3, deflate=True)
        print("wrote %s (%d pages)" % (OUT, len(doc)))
        missing = sorted(set(PLACEHOLDERS))
        if missing:
            print("unresolved placeholders (%d distinct):" % len(missing), file=sys.stderr)
            for p in missing:
                print("  " + p, file=sys.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
