import sys
import re
from fpdf import FPDF

md_path = sys.argv[1]
pdf_path = sys.argv[2]

with open(md_path, 'r') as f:
    lines = f.readlines()

class DocPDF(FPDF):
    def header(self):
        pass
    def footer(self):
        self.set_y(-15)
        self.set_font('DejaVu', '', 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', align='C')

pdf = DocPDF('P', 'mm', 'A4')
pdf.alias_nb_pages()
pdf.set_auto_page_break(auto=True, margin=20)

pdf.add_font('DejaVu', '', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf')
pdf.add_font('DejaVu', 'B', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf')
pdf.add_font('DejaVuSans', '', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
pdf.add_font('DejaVuSans', 'B', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
pdf.add_font('DejaVuMono', '', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
pdf.add_font('DejaVuMono', 'B', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf')

FONT = 'DejaVu'
MONO = 'DejaVuMono'

pdf.add_page()
pdf.set_fill_color(255, 255, 255)

def set_body():
    pdf.set_font(FONT, '', 10)
    pdf.set_text_color(17, 17, 17)

def render_inline(text, base_style=''):
    parts = re.split(r'(\*\*.*?\*\*|\*[^*]+\*|`[^`]+`)', text)
    for part in parts:
        if part.startswith('**') and part.endswith('**'):
            pdf.set_font(FONT, 'B', 10)
            pdf.write(5.5, part[2:-2])
            pdf.set_font(FONT, base_style, 10)
        elif part.startswith('*') and part.endswith('*') and not part.startswith('**'):
            pdf.set_font(FONT, '', 10)
            pdf.set_text_color(60, 60, 60)
            pdf.write(5.5, part[1:-1])
            pdf.set_text_color(17, 17, 17)
            pdf.set_font(FONT, base_style, 10)
        elif part.startswith('`') and part.endswith('`'):
            pdf.set_font(MONO, '', 9)
            pdf.write(5.5, part[1:-1])
            pdf.set_font(FONT, base_style, 10)
        else:
            pdf.write(5.5, part)

def write_paragraph(text):
    set_body()
    render_inline(text)
    pdf.ln(7)

def _cell_height(text, width, font_name, font_style, font_size):
    pdf.set_font(font_name, font_style, font_size)
    line_h = 4.5
    lines = 1
    if pdf.get_string_width(text) > width - 2:
        words = text.split()
        cur = ''
        for w in words:
            test = (cur + ' ' + w).strip()
            if pdf.get_string_width(test) > width - 2:
                lines += 1
                cur = w
            else:
                cur = test
    return max(lines * line_h + 2, 6.5)

def _draw_multicell_row(cells, col_widths, row_h, font_name, font_style, font_size, fill):
    x_start = pdf.get_x()
    y_start = pdf.get_y()
    line_h = 4.5
    for idx, cell in enumerate(cells):
        x = x_start + sum(col_widths[:idx])
        pdf.set_xy(x, y_start)
        pdf.set_font(font_name, font_style, font_size)
        pdf.rect(x, y_start, col_widths[idx], row_h, 'DF')
        pdf.set_xy(x + 1, y_start + 1)
        words = cell.split()
        cur_line = ''
        for w in words:
            test = (cur_line + ' ' + w).strip()
            if pdf.get_string_width(test) > col_widths[idx] - 2:
                pdf.cell(col_widths[idx] - 2, line_h, cur_line)
                pdf.set_xy(x + 1, pdf.get_y() + line_h)
                cur_line = w
            else:
                cur_line = test
        if cur_line:
            pdf.cell(col_widths[idx] - 2, line_h, cur_line)
    pdf.set_xy(x_start, y_start + row_h)

def write_table(table_lines):
    rows = []
    for tl in table_lines:
        tl = tl.strip()
        if tl.startswith('|') and tl.endswith('|'):
            cells = [c.strip() for c in tl[1:-1].split('|')]
            if any(set(c) <= set('- :') for c in cells):
                continue
            rows.append(cells)
    if not rows:
        return

    num_cols = len(rows[0])
    usable_w = 170
    col_widths = [usable_w / num_cols] * num_cols

    pdf.set_draw_color(153, 153, 153)

    header_cells = [re.sub(r'\*\*|`', '', c) for c in rows[0]]
    row_h = 6.5
    for idx, cell in enumerate(header_cells):
        h = _cell_height(cell, col_widths[idx], FONT, 'B', 8)
        if h > row_h:
            row_h = h
    pdf.set_fill_color(232, 232, 232)
    _draw_multicell_row(header_cells, col_widths, row_h, FONT, 'B', 8, True)

    alt_fill = False
    for row in rows[1:]:
        clean_cells = [re.sub(r'\*\*|`', '', c) for c in row]
        row_h = 6.5
        for idx, cell in enumerate(clean_cells):
            h = _cell_height(cell, col_widths[idx], FONT, '', 8)
            if h > row_h:
                row_h = h
        if pdf.get_y() + row_h > 277:
            pdf.add_page()
        if alt_fill:
            pdf.set_fill_color(247, 247, 247)
        else:
            pdf.set_fill_color(255, 255, 255)
        _draw_multicell_row(clean_cells, col_widths, row_h, FONT, '', 8, True)
        alt_fill = not alt_fill
    pdf.set_fill_color(255, 255, 255)
    pdf.ln(4)

i = 0
in_code_block = False
code_lines = []
in_table = False
table_lines = []
para_buffer = ''

def flush_para():
    global para_buffer
    if para_buffer.strip():
        text = para_buffer.strip()
        if text.startswith('> '):
            x = pdf.get_x()
            y = pdf.get_y()
            pdf.set_draw_color(153, 153, 153)
            pdf.line(23, y, 23, y + 10)
            pdf.set_x(27)
            pdf.set_font(FONT, '', 9.5)
            pdf.set_text_color(68, 68, 68)
            clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', text[2:])
            pdf.multi_cell(153, 5, clean)
            pdf.set_text_color(17, 17, 17)
            pdf.ln(4)
        else:
            write_paragraph(text)
    para_buffer = ''

while i < len(lines):
    line = lines[i]
    raw = line.rstrip('\n')

    if raw.startswith('```'):
        if in_code_block:
            in_code_block = False
            pdf.set_font(MONO, '', 7.5)
            pdf.set_fill_color(244, 244, 244)
            pdf.set_draw_color(221, 221, 221)
            block_h = len(code_lines) * 4 + 6
            if pdf.get_y() + block_h > 277:
                pdf.add_page()
            y_top = pdf.get_y()
            pdf.rect(18, y_top, 174, block_h, 'DF')
            pdf.set_xy(22, y_top + 3)
            for cl in code_lines:
                pdf.cell(0, 4, cl)
                pdf.ln(4)
            pdf.ln(4)
            pdf.set_fill_color(255, 255, 255)
            code_lines = []
        else:
            flush_para()
            in_code_block = True
        i += 1
        continue

    if in_code_block:
        code_lines.append(raw)
        i += 1
        continue

    if raw.startswith('|'):
        if not in_table:
            flush_para()
            in_table = True
            table_lines = []
        table_lines.append(raw)
        i += 1
        continue
    elif in_table:
        write_table(table_lines)
        in_table = False
        table_lines = []

    if raw.startswith('# ') and not raw.startswith('##'):
        flush_para()
        pdf.set_font(FONT, 'B', 18)
        pdf.set_text_color(17, 17, 17)
        pdf.cell(0, 10, raw[2:])
        pdf.ln(12)
        pdf.set_draw_color(51, 51, 51)
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())
        pdf.ln(6)
        set_body()
        i += 1
        continue

    if raw.startswith('## '):
        flush_para()
        pdf.ln(3)
        pdf.set_font(FONT, 'B', 13)
        pdf.set_text_color(26, 26, 46)
        pdf.cell(0, 9, raw[3:])
        pdf.ln(10)
        pdf.set_draw_color(204, 204, 204)
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())
        pdf.ln(3)
        set_body()
        i += 1
        continue

    if raw.startswith('### '):
        flush_para()
        pdf.ln(2)
        pdf.set_font(FONT, 'B', 11)
        pdf.set_text_color(51, 51, 51)
        pdf.cell(0, 8, raw[4:])
        pdf.ln(9)
        set_body()
        i += 1
        continue

    if raw.strip() == '---':
        flush_para()
        pdf.ln(2)
        i += 1
        continue

    if raw.strip() == '':
        flush_para()
        i += 1
        continue

    if raw.startswith('- '):
        flush_para()
        pdf.set_x(25)
        set_body()
        pdf.write(5.5, '\u2022  ')
        render_inline(raw[2:])
        pdf.ln(7)
        i += 1
        continue

    numbered = re.match(r'^(\d+)\.\s+(.*)', raw)
    if numbered:
        flush_para()
        pdf.set_x(25)
        set_body()
        pdf.set_font(FONT, 'B', 10)
        pdf.write(5.5, f'{numbered.group(1)}.  ')
        set_body()
        render_inline(numbered.group(2))
        pdf.ln(7)
        i += 1
        continue

    para_buffer += ' ' + raw if para_buffer else raw
    i += 1

flush_para()
if in_table:
    write_table(table_lines)

pdf.output(pdf_path)
print(f"PDF written to {pdf_path}")
