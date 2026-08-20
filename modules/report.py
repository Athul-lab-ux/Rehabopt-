"""
================================================================
REHABOPT — modules/report.py
Daily report card + PDF export (Session 4).

After a session the patient can open the report page and download a
PDF. The report contains:
  * patient info + date + session summary
  * exercise breakdown table (reps, avg ROM, smoothness, tremor)
  * graphs (ROM and smoothness per rep) drawn with reportlab charts
  * simple recommendations

Graphs use reportlab's own charting — no matplotlib needed.
================================================================
"""
import datetime
import json
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.linecharts import HorizontalLineChart

TEAL = colors.HexColor("#00D4AA")
NAVY = colors.HexColor("#0A2540")
GREY = colors.HexColor("#666666")


# ==================================================================
# chart helper — small line chart from a list of numbers
# ==================================================================
def _line_chart(values, title, ylabel, width=430, height=110):
    d = Drawing(width, height + 18)
    chart = HorizontalLineChart()
    chart.x = 40
    chart.y = 22
    chart.width = width - 50
    chart.height = height - 30
    chart.data = [list(values) if values else [0]]
    chart.categoryAxis.categoryNames = [str(i + 1) for i in range(len(values))] if values else ["-"]
    chart.categoryAxis.labels.fontSize = 7
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.valueMin = 0
    chart.lines[0].strokeColor = TEAL
    chart.lines[0].strokeWidth = 2
    d.add(chart)
    from reportlab.pdfbase.pdfmetrics import stringWidth
    d.add(_text(str(title), 40, height + 12, 9, NAVY))
    return d


def _text(s, x, y, size, color):
    from reportlab.graphics.shapes import String
    return String(x, y, s, fontSize=size, fillColor=color)


# ==================================================================
# main generator
# ==================================================================
def generate_daily_pdf(user, sessions, rep_logs_by_session, out_path):
    """Create the PDF. `sessions` = DB rows (newest first).
    `rep_logs_by_session` = {session_id: [rep rows]}."""
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=20,
                        textColor=NAVY, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10,
                         textColor=GREY, spaceAfter=10)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=13,
                        textColor=NAVY, spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9.5)

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm)
    story = []

    # ---- header ----
    story.append(Paragraph("🩺 REHABOPT — Clinical Rehabilitation Report", h1))
    story.append(Paragraph(
        f"Patient ID: <b>{user['patient_id']}</b> &nbsp;|&nbsp; "
        f"Email: {user['email']} &nbsp;|&nbsp; "
        f"Date: {datetime.date.today().strftime('%d %b %Y')}", sub))

    if not sessions:
        story.append(Paragraph("No sessions completed yet.", body))
        doc.build(story)
        return out_path

    # ---- summary ----
    total_dur = sum(s["duration_s"] for s in sessions)
    total_reps = sum(s["reps_done"] for s in sessions)
    story.append(Paragraph("1 · Session Summary", h2))
    summary = Table(
        [["Total sessions", "Total duration", "Total reps", "Avg smoothness"],
         [str(len(sessions)), f"{int(total_dur // 60)}m {int(total_dur % 60)}s",
          str(total_reps), "—"]],
        colWidths=[100, 100, 90, 100])
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
    ]))
    story.append(summary)
    story.append(Spacer(1, 6))

    # ---- exercise breakdown ----
    story.append(Paragraph("2 · Exercise Breakdown", h2))
    rows = [["Exercise", "Type", "Reps", "Avg ROM", "Avg Smoothness", "Peak Tremor"]]
    for s in sessions:
        logs = rep_logs_by_session.get(s["id"], [])
        avg_rom = (sum(l["rom"] for l in logs) / len(logs)) if logs else 0
        avg_sm = (sum(l["smoothness"] for l in logs) / len(logs)) if logs else 0
        peak_tr = max((l["tremor_hz"] for l in logs), default=0)
        rows.append([s["exercise"] or "—", s["session_type"],
                     str(s["reps_done"]), f"{avg_rom:.1f}",
                     f"{avg_sm:.1f}", f"{peak_tr:.1f} Hz"])
    table = Table(rows, colWidths=[110, 55, 45, 60, 90, 80])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
    ]))
    story.append(table)
    story.append(Spacer(1, 8))

    # ---- graphs (per latest exercise session) ----
    story.append(Paragraph("3 · Progress Graphs (latest exercise session)", h2))
    ex_sessions = [s for s in sessions if s["session_type"] == "exercise"]
    if ex_sessions:
        latest = ex_sessions[0]
        logs = rep_logs_by_session.get(latest["id"], [])
        if logs:
            story.append(_line_chart([l["rom"] for l in logs], "ROM per rep",
                                     "ROM (deg)"))
            story.append(Spacer(1, 4))
            story.append(_line_chart([l["smoothness"] for l in logs],
                                     "Smoothness per rep (0-100)", "score"))
        story.append(Paragraph(
            f"<i>Exercise: {latest['exercise']} — {len(logs)} reps logged. "
            f"ROM and smoothness are computed live from the 7 maths concepts "
            f"(C1 angles, S1 finite differences, S2 Savitzky-Golay, C4 FFT).</i>",
            body))

    # ---- recommendations ----
    story.append(Paragraph("4 · Recommendations", h2))
    recs = ["Continue daily practice — consistency builds the strongest recovery."]
    for s in ex_sessions:
        logs = rep_logs_by_session.get(s["id"], [])
        if logs:
            avg_sm = sum(l["smoothness"] for l in logs) / len(logs)
            if avg_sm < 70:
                recs.append(f"Your {s['exercise']} smoothness is {avg_sm:.0f}/100 — "
                            "try moving slower and steadier.")
    for r in recs:
        story.append(Paragraph(f"• {r}", body))

    doc.build(story)
    return out_path
