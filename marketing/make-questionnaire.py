"""Builds the FreshAF Pro vetting questionnaire PDF (A4) on the Desktop.
Run: python marketing/make-questionnaire.py   (needs Chrome; renders via --print-to-pdf)."""
import base64, os, subprocess, tempfile

ROOT = r"C:\Users\Evert\Desktop\local Session\freshaf"
DESK = r"C:\Users\Evert\Desktop"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PDF = os.path.join(DESK, "FreshAF Pro Vetting Questionnaire.pdf")

with open(os.path.join(ROOT, "public/img/logo.svg"), "rb") as f:
    LOGO = "data:image/svg+xml;base64," + base64.b64encode(f.read()).decode()

def line(label, wide=False):
    return f'<div class="f{" w" if wide else ""}"><label>{label}</label><span></span></div>'

def box(label, opts):
    return ('<div class="f w"><label>' + label + '</label><div class="opts">' +
            "".join(f'<i></i>{o}&nbsp;&nbsp;&nbsp;' for o in opts) + '</div></div>')

def yn(q, follow="If yes, give details"):
    return f'<div class="ynb"><div class="yn"><div class="q">{q}</div><div class="a"><i></i>Yes &nbsp; <i></i>No</div></div><div class="f det"><label>{follow}</label><span></span></div></div>'

SECTIONS = [
 ("1", "You and your business", [
   line("Full name (as on ID)"), line("ID or passport number"),
   line("Trading name"), line("Registered business name (if any)"),
   box("Business type", ["Sole trader", "(Pty) Ltd", "CC", "Partnership", "Not registered yet"]),
   line("CIPC registration number"), line("Years in operation"),
   line("Mobile number"), line("WhatsApp number (if different)"),
   line("Email address", True), line("Physical address", True),
   line("South African citizen or permanent resident? If not, permit type and expiry", True),
   line("Website / Instagram / Facebook / Google listing", True),
 ]),
 ("2", "Services you offer", [
   box("Service", ["Mobile car wash", "Laundry collection", "Both"]),
   box("Car wash", ["Exterior wash", "Interior valet", "Full valet", "Machine polish", "Engine bay", "Upholstery shampoo"]),
   box("Water method", ["Own water tank", "Customer's tap", "Waterless / rinseless"]),
   box("Power", ["Own generator / battery", "Customer's plug", "No power needed"]),
   box("Laundry", ["Wash and fold", "Ironing", "Dry cleaning", "Duvets and bedding", "Collection and delivery"]),
   line("Laundry: where is washing done? (own premises / home / partner)", True),
   line("Laundry: kilograms you can handle per day"), line("Usual turnaround time"),
   line("Products you use (brands, eco-friendly or not)", True),
 ]),
 ("3", "Area and availability", [
   line("Areas you can cover", True), line("Furthest you will travel (km)"),
   line("Jobs you can do per day"),
   box("Days available", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Public holidays"]),
   line("Hours available"),
   box("Can you take same-day / ASAP jobs?", ["Yes", "Sometimes", "No, bookings only"]),
 ]),
 ("4", "Team, transport and equipment", [
   line("How many people will do FreshAF jobs (including you)?"),
   box("They are", ["Just me", "Employees", "Subcontractors", "Family members"]),
   box("Registered for UIF / COIDA for staff?", ["Yes", "No", "No staff"]),
   line("Vehicle(s) used: make, model, registration", True),
   line("Driver's licence code"), line("Uniform or branded clothing?"),
   line("Main equipment you own (pressure washer, vacuum, polisher, machines, etc.)", True),
   box("Smartphone with data and WhatsApp?", ["Android", "iPhone", "No smartphone"]),
 ]),
 ("5", "Compliance and money", [
   line("SARS income tax number"), box("VAT registered?", ["Yes", "No"]),
   line("VAT number (if registered)"), line("SARS tax compliance PIN (if you have one)"),
   line("Bank and account holder name (must match your ID or company)", True),
   box("Public liability insurance?", ["Yes", "No", "Busy getting it"]),
   line("Insurer and cover amount"),
   line("If you damage a customer's car or clothing, how do you handle it?", True),
   box("Can you accept card payments yourself?", ["Yes (Yoco, SnapScan, etc.)", "Cash and EFT only"]),
 ]),
 ("6", "Background and trust", [
   yn("Have you, or anyone who will do jobs with you, ever been convicted of a criminal offence?"),
   yn("Is anyone in your team facing criminal charges or under investigation now?"),
   box("Will every team member provide a SAPS police clearance certificate (under 6 months old)?", ["Yes", "No"]),
   yn("Have you worked on another app or platform before (Uber, Bolt, SweepSouth, etc.)?", "Which, and for how long?"),
   yn("Has any platform ever removed or deactivated you?", "Which, and why?"),
   yn("Have you had a customer complaint, dispute or claim in the last 2 years?"),
 ]),
 ("7", "References", [
   line("Reference 1: name, phone, relationship (customer you have served)", True),
   line("Reference 2: name, phone, relationship", True),
 ]),
 ("8", "How FreshAF works: please confirm", [
   box("You set your own prices. FreshAF adds a 10% fee on top, paid by the customer. You keep 100% of your price.", ["Understood"]),
   box("On cash jobs you collect the full amount, and the 10% fee is owed back to FreshAF.", ["Understood"]),
   box("You work as an independent contractor, not as a FreshAF employee.", ["Understood"]),
   box("Job offers arrive on your phone. You must accept them within the time limit or they go to someone else.", ["Understood"]),
   box("Customers rate every job. Low ratings or no-shows can lead to suspension.", ["Understood"]),
 ]),
]

DOCS = ["Copy of ID or passport (both sides of smart ID card)", "Proof of address, less than 3 months old",
        "Bank confirmation letter, less than 3 months old", "SAPS police clearance certificate for each team member",
        "CIPC registration certificate (if registered)", "SARS tax number proof / tax compliance PIN letter",
        "Public liability insurance certificate (if you have it)", "Driver's licence and vehicle licence disc",
        "3 to 5 photos of your work, and one of your equipment", "A clear head-and-shoulders photo (for your profile)"]

def section(num, title, fields):
    return f'<section><h2><b>{num}</b>{title}</h2><div class="grid">{"".join(fields)}</div></section>'

HTML = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size:A4; margin:14mm 14mm 16mm; }}
* {{ margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
body {{ font-family:'Segoe UI',Arial,sans-serif; color:#12303a; font-size:9.6pt; }}
header {{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #1799C2; padding-bottom:8px; }}
header img {{ height:34px; display:block; }}
header .t {{ text-align:right; }}
header .t div:first-child {{ font-size:15pt; font-weight:700; color:#10424F; }}
header .t div:last-child {{ font-size:8.5pt; color:#5b7480; }}
.intro {{ background:#eef6f9; border-left:4px solid #1799C2; padding:9px 12px; margin:12px 0 4px; line-height:1.45; }}
section {{ margin-top:12px; break-inside:auto; }}
h2 {{ font-size:11pt; color:#10424F; margin-bottom:6px; display:flex; align-items:center; gap:8px; break-after:avoid; }}
h2 b {{ background:#10424F; color:#fff; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9pt; }}
.grid {{ display:grid; grid-template-columns:1fr 1fr; column-gap:14px; row-gap:7px; }}
.f {{ break-inside:avoid; }}
.f.w, .ynb {{ grid-column:1 / -1; }}
.ynb {{ break-inside:avoid; }}
.f label {{ display:block; font-size:8.3pt; color:#3f5d68; margin-bottom:1px; }}
.f span {{ display:block; border-bottom:1px solid #9fb6be; height:17px; }}
.opts {{ line-height:1.9; }}
i {{ display:inline-block; width:10px; height:10px; border:1.3px solid #10424F; border-radius:2px; vertical-align:-1px; margin-right:4px; }}
.yn {{ display:flex; justify-content:space-between; gap:12px; break-inside:avoid; break-after:avoid; }}
.yn .a {{ white-space:nowrap; }}
.det label {{ color:#7a929b; }}
ul.docs {{ columns:2; column-gap:18px; list-style:none; }}
ul.docs li {{ break-inside:avoid; margin-bottom:5px; line-height:1.35; }}
.decl {{ border:1.5px solid #10424F; border-radius:8px; padding:10px 12px; break-inside:avoid; margin-top:12px; }}
.decl p {{ line-height:1.45; margin-bottom:8px; }}
.office {{ margin-top:12px; border:1px dashed #9fb6be; border-radius:8px; padding:8px 12px; break-inside:avoid; color:#5b7480; }}
.office .grid {{ grid-template-columns:1fr 1fr 1fr; }}
footer {{ margin-top:12px; font-size:8pt; color:#5b7480; text-align:center; }}
</style></head><body>
<header><img src="{LOGO}" alt="FreshAF"><div class="t"><div>FreshAF Pro application</div><div>Service provider vetting questionnaire</div></div></header>
<div class="intro">Thank you for your interest in joining FreshAF as a Pro. Please answer every question honestly and send it back with
the documents listed at the end. We check every applicant before they can receive jobs, because customers let you into their
homes and hand over their cars and clothes. Incomplete applications cannot be approved.
Return to <b>admin@freshaf.io</b> or WhatsApp <b>078 299 1050</b>.</div>
{"".join(section(*s) for s in SECTIONS)}
<section><h2><b>9</b>Documents to attach</h2><ul class="docs">{"".join(f"<li><i></i>{d}</li>" for d in DOCS)}</ul></section>
<div class="decl"><h2><b>10</b>Declaration and consent</h2>
<p>I confirm that the information in this form and the documents I attach are true and complete. I understand that false
or missing information is grounds to reject my application or remove me from FreshAF at any time.</p>
<p>I consent to FreshAF (Pty) Ltd verifying my identity, address, bank details, references and criminal record, and to
processing my personal information for that purpose and for running my FreshAF Pro account, in line with the Protection of
Personal Information Act (POPIA) and the privacy policy at freshaf.io/privacy.</p>
<div class="grid">{line("Full name")}{line("Signature")}{line("Date")}{line("Place")}</div></div>
<div class="office"><b>For FreshAF use only</b><div class="grid" style="margin-top:6px">
{line("Received")}{line("ID verified")}{line("Police clearance")}{line("References called")}{line("Bank verified")}{line("Decision / date")}</div></div>
<footer>FreshAF (Pty) Ltd · Reg. 2026/683087/07 · freshaf.io · Consider it done.</footer>
</body></html>"""

tmp = os.path.join(tempfile.gettempdir(), "freshaf-questionnaire.html")
with open(tmp, "w", encoding="utf-8") as f:
    f.write(HTML)
if os.path.exists(PDF):
    os.remove(PDF)
subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
                f"--print-to-pdf={PDF}", "--virtual-time-budget=8000", tmp],
               check=False, capture_output=True, timeout=180)
print(("OK   " if os.path.exists(PDF) else "FAIL ") + PDF)
