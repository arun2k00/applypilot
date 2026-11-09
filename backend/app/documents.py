import os
import re
from io import BytesIO
from pathlib import Path
from threading import Lock
from xml.sax.saxutils import escape

import reportlab
from docx import Document
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate

from .matching import normalized, terms

SECTION_ORDER = {
    "summary": "Professional summary",
    "employment": "Experience",
    "achievements": "Achievements",
    "skills": "Skills",
    "education": "Education",
    "certifications": "Certifications",
    "projects": "Projects",
    "languages": "Languages",
    "links": "Professional links",
}
FONT_LOCK = Lock()


def resume_text(fields: dict, selected: list[str] | None = None) -> str:
    head = [fields.get("name", ""), fields.get("headline", "")]
    head.append(
        " | ".join(fields[key] for key in ("email", "phone", "location") if fields.get(key))
    )
    ordered = (
        [*selected, *(key for key in SECTION_ORDER if key not in selected)]
        if selected
        else SECTION_ORDER
    )
    sections = [f"{SECTION_ORDER[key]}\n{fields[key]}" for key in ordered if fields.get(key)]
    return "\n\n".join(["\n".join(line for line in head if line), *sections]).strip()


def prepare_documents(job, fields: dict, tone: str, selected: list[str] | None = None) -> dict:
    skill_map = {normalized(skill): skill for skill in terms(fields.get("skills", ""))}
    relevant = [
        skill_map[normalized(skill)]
        for skill in terms(job.details.get("skills", ""))
        if normalized(skill) in skill_map
    ]
    gaps = [
        skill
        for skill in terms(job.details.get("skills", ""))
        if normalized(skill) not in skill_map
    ]
    if selected is None:
        selected = ["skills"] if relevant else []
    role_at_company = f"{job.title} role at {job.company}"
    introduction = {
        "professional": f"I am writing to express interest in the {role_at_company}.",
        "concise": f"I am interested in the {role_at_company}.",
        "formal": f"Please consider my application for the {role_at_company}.",
        "conversational": f"I would like to talk with you about the {role_at_company}.",
        "executive": f"I would welcome a discussion about the {role_at_company}.",
    }[tone]
    evidence = []
    if fields.get("headline"):
        evidence.append(f"My professional focus: {fields['headline']}.")
    if relevant:
        evidence.append(f"Relevant skills from my background include {', '.join(relevant)}.")
    if fields.get("achievements"):
        evidence.append(
            "One achievement from my background:\n" + fields["achievements"].splitlines()[0]
        )
    letter = "\n\n".join(
        [
            "Dear Hiring Team,",
            introduction,
            *evidence,
            "Thank you for considering my application.",
            "Sincerely,\n" + fields["name"],
        ]
    )
    return {
        "master": resume_text(fields),
        "resume": resume_text(fields, selected),
        "letter": letter,
        "gaps": gaps,
        "reordered": selected,
    }


def clean_lines(text: str) -> list[str]:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text).splitlines()


def export_docx(text: str) -> bytes:
    document = Document()
    for index, line in enumerate(clean_lines(text)):
        if index == 0 and line and len(line) < 120:
            document.add_heading(line, level=1)
        else:
            document.add_paragraph(line)
    result = BytesIO()
    document.save(result)
    return result.getvalue()


def export_pdf(text: str) -> bytes:
    default = Path(reportlab.__file__).parent / "fonts" / "Vera.ttf"
    font_path = os.getenv("APPLYPILOT_PDF_FONT", str(default))
    with FONT_LOCK:
        if "ApplyPilotText" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("ApplyPilotText", font_path))
        font = pdfmetrics.getFont("ApplyPilotText")
        lines = clean_lines(text)
        if any(
            ord(char) not in font.face.charToGlyph
            for line in lines
            for char in line
            if char != "\t"
        ):
            raise ValueError("Use DOCX or configure a PDF font that supports this text.")
        result = BytesIO()
        body = ParagraphStyle(
            "Body", fontName="ApplyPilotText", fontSize=10, leading=14, spaceAfter=4
        )
        heading = ParagraphStyle("Heading", parent=body, fontSize=17, leading=22, spaceAfter=12)
        document = SimpleDocTemplate(result, title="ApplyPilot application document")
        document.build(
            [
                Paragraph(escape(line.expandtabs(4)) or "&#160;", heading if index == 0 else body)
                for index, line in enumerate(lines)
            ]
        )
        return result.getvalue()
