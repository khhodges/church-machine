"""
Generate the Six Laws of CLOOMC broadsheet PDF.

Usage:
    python3 generate_six_laws.py

Output: six-laws-review.pdf (A3 landscape, single page)

Requires: fpdf2 (see requirements.txt / pyproject.toml)
Note: fpdf2 may emit a warning that Pillow is unavailable. This is harmless
      because the broadsheet uses no images -- only built-in Helvetica fonts.
"""
from fpdf import FPDF

OUTPUT = "six-laws-review.pdf"

PAGE_W_MM = 420
PAGE_H_MM = 297

LAWS = [
    {
        "number": "I",
        "name": "Oil and Water",
        "summary": "Capabilities and data never mix.",
        "commentary": (
            "The hard separation between code capabilities and raw data is the "
            "cornerstone of the architecture. Where conventional ISAs treat a "
            "pointer as just another integer  --  and pay dearly for it  --  the Church "
            "Machine makes the distinction physical. Forging a capability from "
            "raw bits is not merely forbidden by policy; it is impossible by "
            "construction. This collapses entire classes of exploit (use-after-free, "
            "type confusion, capability spray) before a single line of application "
            "code runs. The tension: the hardware tagging overhead must be justified "
            "by demonstrated performance targets, and the programmer model for "
            "interoperating with legacy data formats needs careful documentation."
        ),
    },
    {
        "number": "II",
        "name": "Double Checking",
        "summary": "Every READ and WRITE is validated by a capability context register.",
        "commentary": (
            "Rather than a single, monolithic memory-protection unit, the Church "
            "Machine places named capability context registers (CR14, CR12, CR5) "
            "at each architectural boundary. Every instruction fetch, every heap "
            "access, every stack operation is checked against the relevant register "
            "independently. The result is defence in depth baked into the cycle "
            "path  --  not added as a software wrapper. The practical observation: "
            "the CR mapping must be stable across privilege levels; the ongoing "
            "remap work (CR0-CR15 split) is the right time to lock this down so "
            "that toolchain assumptions do not diverge from hardware."
        ),
    },
    {
        "number": "III",
        "name": "Distribution not Centralisation",
        "summary": "No kernel, no central authority  --  authority lives at the edge.",
        "commentary": (
            "This law reads as an organisational principle as much as a technical "
            "one. By refusing a privileged kernel and distributing capabilities "
            "only as far as each abstraction genuinely requires, the architecture "
            "eliminates the single point that attackers spend most of their energy "
            "targeting. The analogy to networked systems is deliberate: a misconfigured "
            "central authority in today's cloud infrastructure can cascade into "
            "continent-scale outages. The Church Machine makes that failure mode "
            "structurally impossible. The challenge is communicating this to "
            "programmers trained on POSIX  --  the contributing guidelines and "
            "quick-start narrative are the right places to address that gap."
        ),
    },
    {
        "number": "IV",
        "name": "Democratic not Dictatorial",
        "summary": "No root, no superuser  --  every abstraction plays by identical rules.",
        "commentary": (
            "Democratic is a bold word choice, and intentionally so. The boot "
            "firmware itself operates under bounded capabilities; there is no "
            "escape hatch, no manufacturer override, no God mode. This is "
            "a strong claim and one that will attract scrutiny  --  the tapeout "
            "verification process and the open-source HDL are the evidence that "
            "makes it credible. The strength here is also the political message: "
            "the machine cannot be secretly neutered by a vendor after sale. "
            "For a broadsheet audience, this is the most immediately compelling "
            "of the six laws, and the one most worth foregrounding."
        ),
    },
    {
        "number": "V",
        "name": "Calibrated and Transparent",
        "summary": "Every capability carries explicit, inspectable permission bits and bounds.",
        "commentary": (
            "Ambient authority  --  the invisible permission granted by virtue of "
            "who you are rather than what you hold  --  is the root cause of most "
            "privilege-escalation chains. Law V eliminates it: every R, W, X, L, "
            "S, E bit is visible in the capability word itself, inspectable at "
            "runtime, and bounded by an explicit range. The observation for the "
            "project: the IDE's lump metadata viewer is the natural user-facing "
            "surface for this law. Showing live capability words alongside "
            "human-readable permission summaries would make the law tangible "
            "rather than theoretical."
        ),
    },
    {
        "number": "VI",
        "name": "Open Source",
        "summary": "Hardware, toolchain, IDE, and libraries  --  all inspectable and buildable.",
        "commentary": (
            "Open Source as a constitutional law rather than a licensing footnote "
            "is the clearest statement of the project's values. No black boxes "
            "means the security model can be audited end-to-end  --  from FPGA "
            "primitive to assembler to abstraction library. This is the foundation "
            "that makes the other five laws credible: without it, 'no hidden "
            "permissions' is merely a vendor promise. The practical imperative "
            "is keeping the build reproducible and the HDL readable. Follow the "
            "project, contribute, and verify for yourself at CLOOMC.org."
        ),
    },
]

INK        = (13, 13, 13)
PAPER      = (245, 240, 232)
ACCENT     = (192, 57, 43)
MASTHEAD   = (192, 57, 43)
PANEL_BG   = (253, 250, 244)
PANEL_BRD  = (200, 187, 170)
CAPTION    = (80, 80, 80)
LIGHT_GREY = (170, 170, 170)
WHITE      = (255, 255, 255)


class BroadsheetPDF(FPDF):
    def header(self):
        pass

    def footer(self):
        pass


def build_pdf():
    pdf = BroadsheetPDF(orientation="L", unit="mm", format="A3")
    pdf.set_auto_page_break(False)
    pdf.add_page()

    W = PAGE_W_MM
    H = PAGE_H_MM

    MARGIN_X  = 18
    MARGIN_Y  = 14
    HEADER_H  = 66
    FOOTER_H  = 18
    GUTTER    = 5

    pdf.set_fill_color(*PAPER)
    pdf.rect(0, 0, W, H, "F")

    pdf.set_fill_color(*MASTHEAD)
    pdf.rect(0, 0, W, HEADER_H, "F")

    pdf.set_fill_color(245, 240, 232)
    pdf.rect(0, HEADER_H, W, 2.5, "F")

    pdf.set_text_color(*WHITE)
    pdf.set_font("Helvetica", "B", 38)
    pdf.set_xy(0, 9)
    pdf.cell(W, 16, "THE SIX LAWS OF CLOOMC", align="C")

    pdf.set_font("Helvetica", "", 19)
    pdf.set_text_color(255, 210, 200)
    pdf.set_xy(0, 27)
    pdf.cell(W, 13, "An Independent Review   --   The Church-Turing Machine Model  |  Security by Construction, Not Convention", align="C")

    pdf.set_font("Helvetica", "I", 15)
    pdf.set_text_color(255, 180, 165)
    pdf.set_xy(0, 43)
    pdf.cell(W, 11, "Every computer you use runs on an architecture designed in the 1940s. The Church Machine is a different answer.", align="C")

    body_top    = HEADER_H + 2.5 + GUTTER
    body_bottom = H - FOOTER_H - GUTTER
    body_h      = body_bottom - body_top
    body_w      = W - 2 * MARGIN_X

    COLS = 3
    ROWS = 2
    panel_w = (body_w - (COLS - 1) * GUTTER) / COLS
    panel_h = (body_h - (ROWS - 1) * GUTTER) / ROWS

    for idx, law in enumerate(LAWS):
        col = idx % COLS
        row = idx // COLS

        px = MARGIN_X + col * (panel_w + GUTTER)
        py = body_top + row * (panel_h + GUTTER)

        pdf.set_fill_color(*PANEL_BG)
        pdf.set_draw_color(*PANEL_BRD)
        pdf.set_line_width(0.3)
        pdf.rect(px, py, panel_w, panel_h, "FD")

        BAR_H = 11
        pdf.set_fill_color(*ACCENT)
        pdf.rect(px, py, panel_w, BAR_H, "F")

        pdf.set_font("Helvetica", "B", 20)
        pdf.set_text_color(*WHITE)
        pdf.set_xy(px + 3, py + 1)
        pdf.cell(16, BAR_H - 1, law["number"])

        pdf.set_font("Helvetica", "B", 13)
        pdf.set_xy(px + 22, py + 2.5)
        pdf.cell(panel_w - 26, BAR_H - 2, law["name"].upper())

        cur_y = py + BAR_H + 3.5

        pdf.set_font("Helvetica", "I", 11.5)
        pdf.set_text_color(*CAPTION)
        pdf.set_xy(px + 3, cur_y)
        pdf.multi_cell(panel_w - 6, 6.6, law["summary"])
        cur_y = pdf.get_y() + 2.5

        pdf.set_draw_color(*PANEL_BRD)
        pdf.set_line_width(0.2)
        pdf.line(px + 3, cur_y, px + panel_w - 3, cur_y)
        cur_y += 3

        pdf.set_font("Helvetica", "", 11)
        pdf.set_text_color(*INK)
        pdf.set_xy(px + 3, cur_y)
        bottom_limit = py + panel_h - 3
        available_h = bottom_limit - cur_y
        pdf.multi_cell(panel_w - 6, 6.2, law["commentary"], max_line_height=6.2)

    FOOTER_Y = H - FOOTER_H
    pdf.set_fill_color(*INK)
    pdf.rect(0, FOOTER_Y, W, FOOTER_H, "F")

    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, FOOTER_Y - 1.5, W, 1.5, "F")

    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(MARGIN_X, FOOTER_Y + 3)
    pdf.cell(30, 8, "cloomc.org")

    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*LIGHT_GREY)
    centre_text = "The Church Machine  --  security built into every memory access, enforced by the hardware itself."
    pdf.set_xy(W / 2 - 90, FOOTER_Y + 4)
    pdf.cell(180, 6, centre_text, align="C")

    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(130, 130, 130)
    cta = "Inspect the HDL. Build from source. Contribute. The architecture belongs to everyone."
    pdf.set_xy(W - MARGIN_X - 100, FOOTER_Y + 4.5)
    pdf.cell(100, 5, cta, align="R")

    pdf.output(OUTPUT)
    print(f"PDF written to {OUTPUT}")


if __name__ == "__main__":
    build_pdf()
