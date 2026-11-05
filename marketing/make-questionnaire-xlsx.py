"""Builds the FreshAF Pro vetting questionnaire as a fillable Excel workbook.

Same questions as the PDF, but typed into cells instead of written on lines, with dropdowns
wherever the answer is a fixed choice. The point of the Excel version is the third sheet:
it turns a completed form into the exact row the suppliers table wants, so a returned
workbook is loaded rather than retyped.

Banking account numbers are deliberately NOT asked for here. A spreadsheet travels by email
and sits in inboxes in the clear; account numbers belong in the app, where they are encrypted
at rest. The form asks only for the bank and the account holder's name, which is what we need
in order to check that the name matches the ID.

Run: python marketing/make-questionnaire-xlsx.py
"""
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outdir import outdir  # noqa: E402

OUT = os.path.join(outdir(), "FreshAF Pro Vetting Questionnaire.xlsx")

NAVY = "10424F"
INPUT_FILL = PatternFill("solid", fgColor="FFF9D6")   # yellow: type here
BAND_FILL = PatternFill("solid", fgColor="EEF6F9")
HEAD_FILL = PatternFill("solid", fgColor=NAVY)
NOTE_FILL = PatternFill("solid", fgColor="FBEEEE")

F = "Arial"
H1 = Font(name=F, size=16, bold=True, color="FFFFFF")
H2 = Font(name=F, size=11, bold=True, color="FFFFFF")
LBL = Font(name=F, size=10, color="12303A")
LBL_B = Font(name=F, size=10, bold=True, color="12303A")
ANS = Font(name=F, size=10, color="0B2936")
EG = Font(name=F, size=9, italic=True, color="8A9AA2")
NOTE = Font(name=F, size=9, italic=True, color="8A3B3B")

THIN = Side(style="thin", color="C9D8DE")
EDGE = Border(bottom=THIN)

CARD_Q = ("Do you have your own card machine or payment app? "
          "(FreshAF collects all payment from the customer; this is for our records only)")
EQUIP_Q = "Main equipment you own (pressure washer, vacuum, polisher, machines)"

# kind, label, options, example
#   h = section heading   t = free text   c = dropdown   m = Yes/No per option   n = note
S = [
    ("h", "1. You and your business"),
    ("t", "Full name (as on ID)", None, "Sipho Dlamini"),
    ("t", "ID or passport number", None, "8805125800087"),
    ("t", "Trading name", None, "Sipho's Mobile Wash"),
    ("t", "Registered business name (if any)", None, "Dlamini Auto Care (Pty) Ltd"),
    ("c", "Business type", ["Sole trader", "(Pty) Ltd", "CC", "Partnership", "Not registered yet"], "Sole trader"),
    ("t", "CIPC registration number", None, "2023/123456/07"),
    ("t", "Years in operation", None, "4"),
    ("t", "Mobile number", None, "082 123 4567"),
    ("t", "WhatsApp number (if different)", None, ""),
    ("t", "Email address", None, "sipho@example.co.za"),
    ("t", "Physical address", None, "12 Main Road, Durbanville, 7550"),
    ("t", "South African citizen or permanent resident? If not, permit type and expiry", None, "SA citizen"),
    ("t", "Website / Instagram / Facebook / Google listing", None, "instagram.com/siphowash"),

    ("h", "2. Services you offer"),
    ("c", "Service", ["Mobile car wash", "Laundry collection", "Both"], "Mobile car wash"),
    ("m", "Car wash: what you do",
     ["Exterior wash", "Interior valet", "Full valet", "Machine polish", "Engine bay", "Upholstery shampoo"], "Yes"),
    ("c", "Water method", ["Own water tank", "Customer's tap", "Waterless / rinseless"], "Own water tank"),
    ("c", "Power", ["Own generator / battery", "Customer's plug", "No power needed"], "Own generator / battery"),
    ("m", "Laundry: what you do",
     ["Wash and fold", "Ironing", "Dry cleaning", "Duvets and bedding", "Collection and delivery"], "No"),
    ("t", "Laundry: where is washing done? (own premises / home / partner)", None, "n/a"),
    ("t", "Laundry: kilograms you can handle per day", None, "n/a"),
    ("t", "Usual turnaround time", None, "Same day"),
    ("t", "Products you use (brands, eco-friendly or not)", None, "Autoglym, biodegradable"),

    ("h", "3. Area and availability"),
    ("t", "Areas you can cover", None, "Durbanville, Brackenfell, Kraaifontein"),
    ("t", "Furthest you will travel (km)", None, "20"),
    ("t", "Jobs you can do per day", None, "5"),
    ("m", "Days available", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Public holidays"], "Yes"),
    ("t", "Hours available", None, "07:00 - 17:00"),
    ("c", "Can you take same-day / ASAP jobs?", ["Yes", "Sometimes", "No - bookings only"], "Yes"),

    ("h", "4. Team, transport and equipment"),
    ("t", "How many people will do FreshAF jobs (including you)?", None, "2"),
    ("c", "They are", ["Just me", "Employees", "Subcontractors", "Family members"], "Employees"),
    ("c", "Registered for UIF / COIDA for staff?", ["Yes", "No", "No staff"], "Yes"),
    ("t", "Vehicle(s) used: make, model, registration", None, "Toyota Hilux, CA 123 456"),
    ("t", "Driver's licence code", None, "Code 08"),
    ("t", "Uniform or branded clothing?", None, "Branded golf shirts"),
    ("t", EQUIP_Q, None, "Karcher K5, wet/dry vac, DA polisher"),
    ("c", "Smartphone with data and WhatsApp?", ["Android", "iPhone", "No smartphone"], "Android"),

    ("h", "5. Compliance and money"),
    ("t", "SARS income tax number", None, "9012345678"),
    ("c", "VAT registered?", ["Yes", "No"], "No"),
    ("t", "VAT number (if registered)", None, ""),
    ("t", "SARS tax compliance PIN (if you have one)", None, ""),
    ("t", "Bank and account holder name (must match your ID or company)", None, "FNB - S Dlamini"),
    ("n", "Do NOT write your account number here. You enter your banking details in the app, where they are "
          "encrypted. A spreadsheet sits in email inboxes in the clear."),
    ("c", "Public liability insurance?", ["Yes", "No", "Busy getting it"], "Busy getting it"),
    ("t", "Insurer and cover amount", None, ""),
    ("t", "If you damage a customer's car or clothing, how do you handle it?", None, "I repair or replace it at my cost"),
    ("c", CARD_Q, ["Yes (Yoco, SnapScan or similar)", "No - cash and EFT only"], "No - cash and EFT only"),

    ("h", "6. Background and trust"),
    ("c", "Have you, or anyone who will do jobs with you, ever been convicted of a criminal offence?", ["No", "Yes"], "No"),
    ("t", "If yes, give details", None, ""),
    ("c", "Is anyone in your team facing criminal charges or under investigation now?", ["No", "Yes"], "No"),
    ("t", "If yes, give details (2)", None, ""),
    ("c", "Will every team member provide a SAPS police clearance certificate (under 6 months old)?", ["Yes", "No"], "Yes"),
    ("c", "Have you worked on another app or platform before (Uber, Bolt, SweepSouth, etc.)?", ["No", "Yes"], "No"),
    ("t", "If yes, which and for how long?", None, ""),
    ("c", "Has any platform ever removed or deactivated you?", ["No", "Yes"], "No"),
    ("t", "If yes, which and why?", None, ""),
    ("c", "Have you had a customer complaint, dispute or claim in the last 2 years?", ["No", "Yes"], "No"),
    ("t", "If yes, give details (3)", None, ""),

    ("h", "7. References"),
    ("t", "Reference 1: name, phone, relationship (customer you have served)", None,
     "Mrs A Botha, 083 555 1212, regular customer"),
    ("t", "Reference 2: name, phone, relationship", None, "J Pieterse, 072 444 9090, customer"),

    ("h", "8. How FreshAF works: please confirm"),
    ("c", "FreshAF buys each job from you at YOUR price. You set it, and FreshAF pays it in full. "
          "No commission or platform fee is deducted from you.", ["Understood"], "Understood"),
    ("c", "FreshAF then sells the job to the customer at its own price, which includes FreshAF's margin. "
          "The customer sees one price only. What the customer pays does not change what you are paid.",
     ["Understood"], "Understood"),
    ("c", "You are paid weekly, by the Wednesday following the week in which you completed the job, "
          "against your invoice or a self-billed statement.", ["Understood"], "Understood"),
    ("c", "On cash jobs you collect the full amount as FreshAF's collection agent. You keep your own price; "
          "the balance belongs to FreshAF and is payable on demand. Your cash balance shows in the app, and "
          "at R300 owed you cannot take new jobs until you settle it.", ["Understood"], "Understood"),
    ("c", "You work as an independent contractor, not as a FreshAF employee.", ["Understood"], "Understood"),
    ("c", "Job offers arrive on your phone. You must accept them within the time limit or they go to someone else.",
     ["Understood"], "Understood"),
    ("c", "Customers rate every job. Low ratings or no-shows can lead to suspension.", ["Understood"], "Understood"),

    ("h", "9. Documents attached"),
    ("m", "Attached",
     ["Copy of ID or passport (both sides of smart ID card)",
      "Proof of address, less than 3 months old",
      "Bank confirmation letter, less than 3 months old",
      "SAPS police clearance certificate for each team member",
      "CIPC registration certificate (if registered)",
      "SARS tax number proof / tax compliance PIN letter",
      "Public liability insurance certificate (if you have it)",
      "Driver's licence and vehicle licence disc",
      "3 to 5 photos of your work, and one of your equipment",
      "A clear head-and-shoulders photo (for your profile)"], "Yes"),

    ("h", "10. Declaration and consent"),
    ("n", "I confirm that the information in this form and the documents I attach are true and complete. "
          "I understand that false or missing information is grounds to reject my application or remove me "
          "from FreshAF at any time."),
    ("n", "I consent to FreshAF (Pty) Ltd verifying my identity, address, bank details, references and criminal "
          "record, and to processing my personal information for that purpose and for running my FreshAF Pro "
          "account, in line with the Protection of Personal Information Act (POPIA) and the privacy policy at "
          "freshaf.io/privacy."),
    ("c", "I agree to the declaration and consent above", ["I agree"], "I agree"),
    ("t", "Full name (typing it here counts as your signature)", None, "Sipho Dlamini"),
    ("t", "Date", None, "2026-11-05"),
    ("t", "Place", None, "Durbanville"),
]


def build():
    wb = Workbook()
    ws = wb.active
    ws.title = "Application"
    lists = wb.create_sheet("Lists")
    rows = {}            # label -> row number, so the Load sheet can point at them
    list_col = 0

    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 62
    ws.column_dimensions["C"].width = 42
    ws.column_dimensions["D"].width = 34

    ws.merge_cells("B1:D1")
    ws["B1"] = "FreshAF Pro application - vetting questionnaire"
    ws["B1"].font = H1
    ws["B1"].fill = HEAD_FILL
    ws["B1"].alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 30

    ws.merge_cells("B2:D2")
    ws["B2"] = ("Fill in every YELLOW cell in column C. Column D holds examples only - do not change it. "
                "Cells with a dropdown arrow are lists: click the cell and choose. Answer every question; "
                "incomplete applications cannot be approved. Save and email back to admin@freshaf.io, "
                "or WhatsApp 078 299 1050.")
    ws["B2"].font = Font(name=F, size=9, color="12303A")
    ws["B2"].fill = BAND_FILL
    ws["B2"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[2].height = 44

    ws["C3"] = "YOUR ANSWER"
    ws["D3"] = "Example"
    for col in ("C", "D"):
        ws[f"{col}3"].font = Font(name=F, size=9, bold=True, color="5B7480")
        ws[f"{col}3"].alignment = Alignment(horizontal="center")

    r = 4

    def answer_cell(row, example):
        a = ws.cell(row=row, column=3)
        a.fill = INPUT_FILL
        a.font = ANS
        a.alignment = Alignment(wrap_text=True, vertical="center")
        a.border = EDGE
        # Text, not General. A 13-digit SA ID number typed into a General cell becomes
        # 8.80513E+12 and the real number is gone; a phone number loses its leading zero.
        # Every answer here is a string as far as we are concerned.
        a.number_format = "@"
        e = ws.cell(row=row, column=4, value=example or "")
        e.font = EG
        e.alignment = Alignment(wrap_text=True, vertical="center")

    def label_cell(row, text, bold=False, indent=1):
        c = ws.cell(row=row, column=2, value=text)
        c.font = LBL_B if bold else LBL
        c.alignment = Alignment(wrap_text=True, vertical="center", indent=indent)
        c.border = EDGE
        return c

    def row_height(text, width=60):
        return max(16, 13 * (len(text) // width + 1))

    for item in S:
        kind, label = item[0], item[1]
        opts = item[2] if len(item) > 2 else None
        example = item[3] if len(item) > 3 else ""

        if kind == "h":
            r += 1
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
            c = ws.cell(row=r, column=2, value=label)
            c.font = H2
            c.fill = HEAD_FILL
            c.alignment = Alignment(vertical="center", indent=1)
            ws.row_dimensions[r].height = 20
            r += 1

        elif kind == "n":
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
            c = ws.cell(row=r, column=2, value=label)
            c.font = NOTE
            c.fill = NOTE_FILL
            c.alignment = Alignment(wrap_text=True, vertical="center", indent=1)
            ws.row_dimensions[r].height = row_height(label, 130)
            r += 1

        elif kind == "t":
            label_cell(r, label)
            answer_cell(r, example)
            rows.setdefault(label, r)
            ws.row_dimensions[r].height = row_height(label)
            r += 1

        elif kind == "c":
            label_cell(r, label)
            answer_cell(r, example)
            rows.setdefault(label, r)
            list_col += 1
            col = get_column_letter(list_col)
            lists.cell(row=1, column=list_col, value=label[:60])
            for i, o in enumerate(opts, start=2):
                lists.cell(row=i, column=list_col, value=o)
            dv = DataValidation(type="list",
                                formula1=f"=Lists!${col}$2:${col}${len(opts) + 1}",
                                allow_blank=True, showDropDown=False)
            ws.add_data_validation(dv)
            dv.add(ws.cell(row=r, column=3))
            ws.row_dimensions[r].height = row_height(label)
            r += 1

        elif kind == "m":
            label_cell(r, label + "  (answer Yes or No for each)", bold=True)
            r += 1
            list_col += 1
            col = get_column_letter(list_col)
            lists.cell(row=1, column=list_col, value="Yes/No")
            lists.cell(row=2, column=list_col, value="Yes")
            lists.cell(row=3, column=list_col, value="No")
            dv = DataValidation(type="list", formula1=f"=Lists!${col}$2:${col}$3",
                                allow_blank=True, showDropDown=False)
            ws.add_data_validation(dv)
            for j, o in enumerate(opts):
                label_cell(r, o, indent=3)
                answer_cell(r, example if j == 0 else "")
                dv.add(ws.cell(row=r, column=3))
                rows.setdefault(f"{label}::{o}", r)
                ws.row_dimensions[r].height = row_height(o)
                r += 1

    ws.freeze_panes = "B4"
    ws.sheet_view.showGridLines = False
    lists.sheet_state = "hidden"

    # ---- the internal vetting record, kept off the applicant's sheet --------
    vet = wb.create_sheet("FreshAF use only")
    vet.column_dimensions["B"].width = 34
    vet.column_dimensions["C"].width = 46
    vet.sheet_view.showGridLines = False
    vet.merge_cells("B1:C1")
    vet["B1"] = "For FreshAF use only - not for the applicant"
    vet["B1"].font = H2
    vet["B1"].fill = HEAD_FILL
    vet["B1"].alignment = Alignment(vertical="center", indent=1)
    vr = 3
    for f in ("Received", "ID verified", "Police clearance", "References called",
              "Bank verified", "Screening call done", "Decision", "Decision date", "Reason"):
        vet.cell(row=vr, column=2, value=f).font = LBL
        a = vet.cell(row=vr, column=3)
        a.fill = INPUT_FILL
        a.font = ANS
        a.border = EDGE
        a.number_format = "@"
        vr += 1

    # ---- the row the suppliers table actually wants -------------------------
    load = wb.create_sheet("Load")
    load.sheet_view.showGridLines = False
    load["A1"] = ("Built automatically from the Application sheet - do not type into row 4. "
                  "These are the columns the suppliers table takes.")
    load["A1"].font = Font(name=F, size=9, italic=True, color="8A9AA2")

    def ref(label):
        row = rows.get(label)
        if row is None:
            raise KeyError(f"Load sheet points at a question that does not exist: {label!r}")
        return f"'Application'!$C${row}"

    svc = ref("Service")
    cols = [
        ("name", ref("Full name (as on ID)")),
        ("email", ref("Email address")),
        ("phone", ref("Mobile number")),
        ("business_name", ref("Trading name")),
        ("id_number", ref("ID or passport number")),
        ("services", None),
        ("service_area", ref("Areas you can cover")),
        ("radius_km", ref("Furthest you will travel (km)")),
        ("vehicle_reg", ref("Vehicle(s) used: make, model, registration")),
        ("equipment_notes", ref(EQUIP_Q)),
    ]
    for i, (head, src) in enumerate(cols, start=1):
        h = load.cell(row=3, column=i, value=head)
        h.font = Font(name=F, size=10, bold=True, color="FFFFFF")
        h.fill = HEAD_FILL
        load.column_dimensions[get_column_letter(i)].width = max(16, len(head) + 4)
        if head == "services":
            formula = (f'=IF({svc}="Both","carwash,laundry",'
                       f'IF({svc}="Mobile car wash","carwash",'
                       f'IF({svc}="Laundry collection","laundry","")))')
        else:
            formula = f'=IF({src}="","",{src})'
        load.cell(row=4, column=i, value=formula).font = ANS

    load["A6"] = ("Banking details are left out of this row on purpose. The pro enters them in the app, where "
                  "they are encrypted at rest. A spreadsheet that travels by email is not a safe place for them.")
    load["A6"].font = NOTE

    wb.save(OUT)
    questions = len([x for x in S if x[0] in ("t", "c", "m")])
    print(f"OK   {OUT}")
    print(f"     {questions} questions, {len(rows)} answer cells")


if __name__ == "__main__":
    build()
