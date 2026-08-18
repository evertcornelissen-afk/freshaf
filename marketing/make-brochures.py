import base64, os, subprocess, sys

ROOT = r"C:\Users\Evert\Desktop\local Session\freshaf"
OUT = r"C:\Users\Evert\AppData\Local\Temp\brochure"
DESK = r"C:\Users\Evert\Desktop"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

def b64(rel, mime):
    with open(os.path.join(ROOT, rel), "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()

LOGO = b64("public/img/logo-dark.svg", "image/svg+xml")
HERO_WASH = b64("marketing/raw/candidates/stock-8.jpg", "image/jpeg")
HERO_LAUNDRY = b64("marketing/raw/candidates/laundry-iron-s5.jpg", "image/jpeg")

# WhatsApp number placeholder — replaced when Evert supplies the real one
WA = "&#95;&#95;&#95;&nbsp;&#95;&#95;&#95;&nbsp;&#95;&#95;&#95;&#95;"

ICONS = {
 "pin":'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
 "bell":'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
 "wallet":'<path d="M20 7H4a2 2 0 0 1 0-4h14v4"/><path d="M4 7v12a2 2 0 0 0 2 2h14V7"/><path d="M16 13h2"/>',
 "check":'<path d="M20 6 9 17l-5-5"/>',
 "tag":'<path d="M20.6 13.4 12 4.8H4.8V12l8.6 8.6a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8Z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
 "clock":'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 "card":'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
 "star":'<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
 "shirt":'<path d="M20.4 7 16 3h-1.9a2.5 2.5 0 0 1-4.2 0H8L3.6 7l2.2 3L7 9.4V21h10V9.4l1.2.6 2.2-3Z"/>',
 "car":'<path d="M6 16l1.6-4.8A2 2 0 0 1 9.5 10h5a2 2 0 0 1 1.9 1.2L18 16"/><path d="M4 19v-1a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
 "phone":'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
}
def ico(n, cls=""):
    return f'<span class="ic {cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{ICONS[n]}</svg></span>'

CSS = """
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { font-family:'Inter','Segoe UI',Arial,sans-serif; color:#12303a; width:210mm; }
.page { width:210mm; height:297mm; position:relative; overflow:hidden; display:flex; flex-direction:column; }

/* ---------- hero ---------- */
.hero { position:relative; height:73mm; background:#0c1c24; overflow:hidden; flex:none; }
.hero .bg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.62; }
.hero .veil { position:absolute; inset:0;
  background:linear-gradient(105deg,rgba(8,22,28,.96) 30%,rgba(8,22,28,.72) 60%,rgba(8,22,28,.30) 100%); }
.hero .inner { position:relative; padding:10mm 13mm 0; height:100%; display:flex; flex-direction:column; }
.brandrow { display:flex; align-items:center; justify-content:space-between; margin-bottom:auto; }
.brandrow img { height:8.6mm; width:auto; display:block; }
.forpros { border:1.6px solid #35c3e8; color:#5fd4f2; font-size:8.5pt; font-weight:800;
  letter-spacing:.20em; padding:2.1mm 4.2mm; border-radius:99px; text-transform:uppercase; }
h1 { color:#fff; font-size:28pt; font-weight:800; font-style:italic; line-height:1.03;
  letter-spacing:-.02em; margin-bottom:4mm; }
h1 em { font-style:italic; color:#35c3e8; }
.sub { color:#cfe3ec; font-size:11.2pt; line-height:1.45; max-width:135mm; padding-bottom:7mm; }

/* ---------- money strip ---------- */
.money { display:flex; gap:0; background:#12414f; flex:none; }
.money > div { flex:1; padding:6mm 6mm; border-right:1px solid rgba(255,255,255,.13); }
.money > div:last-child { border-right:none; }
.money .big { color:#5fd4f2; font-size:15.5pt; font-weight:800; font-style:italic; margin-bottom:1.6mm; letter-spacing:-.01em;}
.money .small { color:#c3dce6; font-size:8.8pt; line-height:1.4; }

/* ---------- body ---------- */
.body { padding:6mm 13mm 0; flex:1; display:flex; flex-direction:column; }
.kicker { display:flex; align-items:center; gap:3mm; margin-bottom:4mm; }
.kicker .bar { width:11mm; height:1.5mm; background:#1799c2; border-radius:2px; }
.kicker h2 { font-size:14pt; font-weight:800; color:#10424f; letter-spacing:-.01em; }

.feat { display:grid; grid-template-columns:1fr 1fr; gap:3.6mm 7mm; margin-bottom:5mm; }
.f { display:flex; gap:3.4mm; }
.ic { flex:none; width:8.4mm; height:8.4mm; border-radius:2.4mm; background:#e4f3f9;
  color:#1178a0; display:flex; align-items:center; justify-content:center; }
.ic svg { width:4.9mm; height:4.9mm; }
.f .t { font-size:10.4pt; font-weight:700; color:#10424f; margin-bottom:.9mm; }
.f .d { font-size:9pt; color:#54727f; line-height:1.42; }

.steps { display:flex; gap:4.6mm; margin-bottom:5mm; }
.st { flex:1; background:#f2f8fb; border-radius:3mm; padding:4.4mm 4.6mm 4.8mm; border-top:1.6mm solid #1799c2; }
.st .n { font-size:9pt; font-weight:800; color:#1799c2; margin-bottom:1.8mm; letter-spacing:.1em; }
.st .h { font-size:10.4pt; font-weight:700; color:#10424f; margin-bottom:1.4mm; }
.st .p { font-size:8.8pt; color:#54727f; line-height:1.42; }

/* ---------- cta ---------- */
.cta { margin-top:auto; background:#10424f; border-radius:3.5mm; padding:6mm 7.5mm; position:relative; overflow:hidden; }
.cta::after { content:''; position:absolute; right:-14mm; top:-22mm; width:70mm; height:70mm; border-radius:50%;
  background:radial-gradient(closest-side,rgba(53,195,232,.30),transparent); }
.cta .lead { color:#5fd4f2; font-size:9pt; font-weight:800; letter-spacing:.16em; text-transform:uppercase; margin-bottom:2.6mm; }
.cta .head { color:#fff; font-size:16.5pt; font-weight:800; font-style:italic; line-height:1.12; margin-bottom:2.6mm; }
.cta .p { color:#c9e2ec; font-size:9.4pt; line-height:1.42; margin-bottom:4mm; max-width:118mm; }
.wa { display:inline-flex; align-items:center; gap:3.4mm; background:#25D366; color:#053b1c;
  padding:3.6mm 6.5mm; border-radius:99px; font-weight:800; font-size:12pt; }
.wa .ic { background:rgba(255,255,255,.35); color:#053b1c; width:7.6mm; height:7.6mm; border-radius:50%; }
.wa .ic svg { width:4.4mm; height:4.4mm; }
.walabel { color:#9fc7d6; font-size:8.2pt; margin-top:2.8mm; }

.foot { padding:3.4mm 13mm 4.4mm; display:flex; justify-content:space-between; align-items:center; flex:none; }
.foot .l { font-size:8.6pt; color:#7d97a3; }
.foot .r { font-size:8.6pt; color:#10424f; font-weight:700; }
.hl { color:#10424f; font-weight:700; }
"""

def brochure(kind):
    wash = kind == "carwash"
    hero = HERO_WASH if wash else HERO_LAUNDRY
    title = "FOR CAR WASH PROS" if wash else "FOR LAUNDRY PROS"

    if wash:
        h1 = "Your quiet hours<br>are worth <em>money.</em>"
        sub = ("FreshAF sends paying customers straight to your phone. You set your own prices, "
               "you choose your area, and you take only the jobs you want.")
        feats = [
            ("tag","You set your own prices","Charge what your work is worth — per wash, per vehicle type. No app tells you what to earn."),
            ("pin","Choose your area and radius","Work only where you want to. Set 5&nbsp;km, 20&nbsp;km or your whole town — change it any time."),
            ("bell","App or WhatsApp alerts","Get new jobs whichever way suits you. No smartphone habits required."),
            ("check","Accept or ignore, always","No penalties, no targets, no obligation. Busy day? Ignore it."),
            ("card","Card or cash","Customers pay how they like. Cash jobs you collect on the spot."),
            ("star","Build your own name","Every rating you earn is yours — customers ask for you by name."),
        ]
        steps = [
            ("STEP 1","Register free","Your details, your services and the prices you want to charge."),
            ("STEP 2","Set your area","Pick your suburb and how far you're willing to travel."),
            ("STEP 3","Start taking jobs","Alerts come to your phone. Accept the ones that suit you."),
        ]
        ctahead = "Only a limited number of<br>washers per area."
        ctap = ("We're signing pros area by area so nobody gets crowded out. "
                "Claim your area now and you keep it when we go live.")
        icon_tag = "car"
    else:
        h1 = "Your machines are<br>standing. <em>Fill them.</em>"
        sub = ("FreshAF sends paying laundry customers straight to your phone. You set your own prices, "
               "you choose your collection area, and you take only the loads you want.")
        feats = [
            ("tag","You set your own prices","Per load, per kilo, per duvet — your rates, your rules. No app tells you what to earn."),
            ("pin","Choose your area and radius","Collect only where it's worth your while. Set 5&nbsp;km, 20&nbsp;km or your whole town."),
            ("bell","App or WhatsApp alerts","New collections come through whichever way suits you."),
            ("check","Accept or ignore, always","Machines already full? Ignore it. No penalties, no targets, no obligation."),
            ("clock","Fill your dead hours","Turn quiet mornings and idle machines into paid loads."),
            ("star","Build your own name","Every rating you earn is yours — customers ask for you by name."),
        ]
        steps = [
            ("STEP 1","Register free","Your details, your services and the prices you want to charge."),
            ("STEP 2","Set your area","Pick your suburb and how far you'll collect and deliver."),
            ("STEP 3","Start taking loads","Alerts come to your phone. Accept the ones that suit you."),
        ]
        ctahead = "Only a limited number of<br>laundry pros per area."
        ctap = ("We're signing pros area by area so nobody gets crowded out. "
                "Claim your area now and you keep it when we go live.")
        icon_tag = "shirt"

    featdivs = "".join(
        f'<div class="f">{ico(i)}<div><div class="t">{t}</div><div class="d">{d}</div></div></div>'
        for i, t, d in feats)
    stepdivs = "".join(
        f'<div class="st"><div class="n">{n}</div><div class="h">{h}</div><div class="p">{p}</div></div>'
        for n, h, p in steps)

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,600;0,700;0,800;1,800&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>
<div class="page">

  <div class="hero">
    <img class="bg" src="{hero}">
    <div class="veil"></div>
    <div class="inner">
      <div class="brandrow"><img src="{LOGO}"><span class="forpros">{title}</span></div>
      <h1>{h1}</h1>
      <div class="sub">{sub}</div>
    </div>
  </div>

  <div class="money">
    <div><div class="big">You name the price</div><div class="small">Set your own rates. What you quote is what you earn.</div></div>
    <div><div class="big">Our 10% is on top</div><div class="small">Added to the customer's bill — never taken out of your money.</div></div>
    <div><div class="big">Free to join</div><div class="small">No signup fee, no monthly fee, no contract, no lock-in.</div></div>
  </div>

  <div class="body">
    <div class="kicker"><span class="bar"></span><h2>What you get</h2></div>
    <div class="feat">{featdivs}</div>

    <div class="kicker"><span class="bar"></span><h2>How it works</h2></div>
    <div class="steps">{stepdivs}</div>

    <div class="cta">
      <div class="lead">Going live soon</div>
      <div class="head">{ctahead}</div>
      <div class="p">{ctap}</div>
      <span class="wa">{ico('phone')}WhatsApp &ldquo;{'WASH' if wash else 'LAUNDRY'}&rdquo; to {WA}</span>
      <div class="walabel">Send your name, your business and your suburb. We'll reserve your area and set you up free.</div>
    </div>
  </div>

  <div class="foot">
    <div class="l">FreshAF &nbsp;·&nbsp; on-demand car wash &amp; laundry &nbsp;·&nbsp; South Africa</div>
    <div class="r">Consider it done.</div>
  </div>

</div></body></html>"""

jobs = [("carwash", "FreshAF Pro Brochure - Car Wash"), ("laundry", "FreshAF Pro Brochure - Laundry")]
for kind, name in jobs:
    html = brochure(kind)
    hp = os.path.join(OUT, f"{kind}.html")
    with open(hp, "w", encoding="utf-8") as f:
        f.write(html)
    pdf = os.path.join(DESK, f"{name}.pdf")
    if os.path.exists(pdf):
        os.remove(pdf)
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox",
                    "--no-pdf-header-footer", f"--print-to-pdf={pdf}",
                    "--virtual-time-budget=12000", hp],
                   check=False, capture_output=True, timeout=180)
    print(("OK   " if os.path.exists(pdf) else "FAIL ") + pdf,
          (str(round(os.path.getsize(pdf)/1024)) + "KB") if os.path.exists(pdf) else "")
