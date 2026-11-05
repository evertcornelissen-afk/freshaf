"""Where the documents we send to pros are written.

Evert's working FreshAF folder on the Desktop, not the repo. These are documents he opens,
attaches to email and sends on WhatsApp, so they live where he actually looks for them. The
repo keeps the scripts that build them, so the wording is still under version control, but
only one copy of each document exists on disk and it is the one that goes out.
"""
import os

OUTDIR = r"C:\Users\Evert\Desktop\FreshAF"


def outdir():
    os.makedirs(OUTDIR, exist_ok=True)
    return OUTDIR
