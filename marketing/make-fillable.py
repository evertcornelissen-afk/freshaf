"""Turns the flat vetting questionnaire into a PDF a Pro can TYPE into and email back.

Chrome's print-to-PDF cannot emit AcroForm fields, so the fields are added afterwards by
matching the artwork: every write-on line is a thin filled rectangle, and every checkbox is
a small stroked square. Both are unmistakable in the drawing list, so the fields land exactly
on the artwork instead of being positioned by hand (which would drift every time the form
is edited).

Field names come from the label printed next to the artwork, so the returned PDF can be read
back programmatically when bulk-loading pros.

Run: python marketing/make-fillable.py
"""
import os, re, sys

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outdir import outdir
FORMS = outdir()
SRC = os.path.join(FORMS, "FreshAF Pro Vetting Questionnaire.pdf")
OUT = os.path.join(FORMS, "FreshAF Pro Vetting Questionnaire (fillable).pdf")

INK = (0.04, 0.16, 0.21)          # #0b2936 — matches the printed text
LINE_MAX_H = 1.6                  # a write-on rule is a hairline fill
LINE_MIN_W = 28.0                 # anything shorter is a border or a divider
BOX_MIN, BOX_MAX = 5.0, 9.0       # the checkbox squares measure ~6.8pt
FIELD_H = 12.5                    # typing area sitting on top of the rule


def slug(text, fallback):
    s = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")[:48]
    return s or fallback


def words_on(page):
    # (x0, y0, x1, y1, word, block, line, word_no)
    return page.get_text("words")


def label_above(words, rect):
    """The caption printed just above a write-on rule."""
    best, best_gap = None, 999
    for x0, y0, x1, y1, w, *_ in words:
        gap = rect.y0 - y1
        if gap < 0 or gap > 16:
            continue
        if x1 < rect.x0 - 6 or x0 > rect.x1:
            continue
        if gap < best_gap - 2:
            best, best_gap = [], gap
        if abs(gap - best_gap) <= 2:
            if best is None:
                best = []
            best.append((x0, w))
    if not best:
        return ""
    return " ".join(w for _, w in sorted(best))


def label_right(words, rect):
    """The option text printed to the right of a checkbox."""
    out = []
    for x0, y0, x1, y1, w, *_ in words:
        if y1 < rect.y0 - 3 or y0 > rect.y1 + 3:
            continue
        if x0 < rect.x1 or x0 > rect.x1 + 85:
            continue
        out.append((x0, w))
    out.sort()
    # Stop at the next checkbox's text: take at most four words.
    return " ".join(w for _, w in out[:4])


def build():
    if not os.path.exists(SRC):
        sys.exit("Build the flat form first: python marketing/make-questionnaire.py")

    doc = pymupdf.open(SRC)
    used, lines, boxes = set(), 0, 0

    for pno, page in enumerate(doc, start=1):
        words = words_on(page)
        rules, squares = [], []
        for dr in page.get_drawings():
            r = dr["rect"]
            if dr["type"] == "f" and r.height <= LINE_MAX_H and r.width >= LINE_MIN_W:
                rules.append(r)
            elif dr["type"] == "s" and BOX_MIN <= r.width <= BOX_MAX and BOX_MIN <= r.height <= BOX_MAX:
                squares.append(r)

        rules.sort(key=lambda r: (round(r.y0), r.x0))
        squares.sort(key=lambda r: (round(r.y0), r.x0))

        # Everything below the "For FreshAF use only" heading is our vetting record, not
        # the applicant's to complete. Locked so a returned form cannot arrive with the
        # decision boxes already filled in.
        office = page.search_for("For FreshAF use only")
        office_y = office[0].y0 if office else None

        for i, r in enumerate(rules):
            name = slug(label_above(words, r), f"field_{pno}_{i}")
            while name in used:
                name += "_2"
            used.add(name)
            w = pymupdf.Widget()
            w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
            w.field_name = f"p{pno}_{name}"
            w.rect = pymupdf.Rect(r.x0 + 1, r.y0 - FIELD_H, r.x1 - 1, r.y0 - 0.5)
            w.text_fontsize = 9
            w.text_color = INK
            w.border_width = 0
            if office_y is not None and r.y0 > office_y:
                w.field_flags = pymupdf.PDF_FIELD_IS_READ_ONLY
            page.add_widget(w)
            lines += 1

        for i, r in enumerate(squares):
            name = slug(label_right(words, r), f"option_{pno}_{i}")
            while name in used:
                name += "_2"
            used.add(name)
            w = pymupdf.Widget()
            w.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
            w.field_name = f"p{pno}_{name}"
            w.rect = pymupdf.Rect(r.x0, r.y0, r.x1, r.y1)
            w.border_width = 0
            w.text_color = INK
            page.add_widget(w)
            boxes += 1

    # Readers that do not build their own appearances still show typed text.
    doc.set_metadata({"title": "FreshAF Pro application — vetting questionnaire",
                      "author": "FreshAF (Pty) Ltd", "subject": "Service provider onboarding"})
    if os.path.exists(OUT):
        os.remove(OUT)
    doc.save(OUT, garbage=3, deflate=True)
    doc.close()
    print(f"OK   {OUT}")
    print(f"     {lines} text fields, {boxes} tick boxes")


if __name__ == "__main__":
    build()
