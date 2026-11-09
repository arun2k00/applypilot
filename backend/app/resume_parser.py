"""Isolated parser entry point. Input is a bounded byte stream from the API."""

import sys
from io import BytesIO
from zipfile import ZipFile

from docx import Document
from docx.table import Table
from pypdf import PdfReader

MAX_UPLOAD = 8 * 1024 * 1024
MAX_TEXT = 50_000


def extract(data: bytes, kind: str) -> str:
    if kind == "pdf":
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted or len(reader.pages) > 40:
            raise ValueError
        lines = (page.extract_text() or "" for page in reader.pages)
        return collect(lines)

    with ZipFile(BytesIO(data)) as archive:
        parts = archive.infolist()
        if len(parts) > 800 or sum(part.file_size for part in parts) > 32 * 1024 * 1024:
            raise ValueError
        if any(part.flag_bits & 1 for part in parts):
            raise ValueError
        if "word/document.xml" not in archive.namelist():
            raise ValueError
    document = Document(BytesIO(data))

    def paragraphs():
        for block in document.iter_inner_content():
            if isinstance(block, Table):
                for row in block.rows:
                    yield " | ".join(cell.text for cell in row.cells)
            else:
                yield block.text

    return collect(paragraphs())


def collect(lines) -> str:
    parts = []
    size = 0
    for line in lines:
        size += len(line) + 1
        if size > MAX_TEXT:
            raise ValueError
        parts.append(line.replace("\x00", ""))
    return "\n".join(parts).strip()


def main() -> None:
    try:
        if sys.platform.startswith("linux"):
            import resource

            memory = 512 * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        data = sys.stdin.buffer.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise ValueError
        sys.stdout.buffer.write(extract(data, sys.argv[1]).encode())
    except Exception:
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
