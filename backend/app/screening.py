import re

from .matching import normalized, terms

MANUAL = re.compile(
    r"\b(salary|compensation|pay|notice|visa|sponsor\w*|citizen\w*|authori[sz]\w*|"
    r"reference\w*|criminal|conviction\w*|disabilit\w*|gender|race|demographic\w*|"
    r"veteran|legal|background check|eligib\w*)\b",
    re.IGNORECASE,
)
PROFILE_TOPICS = (
    (r"\b(education|degree|school|university)\b", "education"),
    (r"\b(certification\w*|credential\w*)\b", "certifications"),
    (r"\b(project\w*|portfolio)\b", "projects"),
    (r"\b(achievement\w*|accomplishment\w*)\b", "achievements"),
    (r"\b(years? of experience|total experience)\b", "total_experience"),
)


def draft_answer(question: str, fields: dict, job) -> dict:
    if MANUAL.search(question):
        return {
            "answer": "",
            "evidence": None,
            "message": "This question needs your direct confirmation. Enter the answer yourself.",
        }
    topic = normalized(question)
    if re.search(r"\b(leadership|managed|management|leading a team)\b", topic):
        for field in ("achievements", "employment", "projects"):
            for line in fields.get(field, "").splitlines():
                if re.search(r"\b(led|managed|supervised|mentored)\b", line, re.IGNORECASE):
                    return answer(line, field)
    for pattern, field in PROFILE_TOPICS:
        if re.search(pattern, topic) and fields.get(field):
            return answer(fields[field], field)
    if re.search(r"\b(interested|interest|why this role|why this company)\b", topic):
        skills = {normalized(skill): skill for skill in terms(fields.get("skills", ""))}
        matches = [
            skills[normalized(skill)]
            for skill in terms(job.details.get("skills", ""))
            if normalized(skill) in skills
        ]
        if matches:
            return answer(
                f"The {job.title} role at {job.company} aligns with my experience in "
                f"{', '.join(matches)}.",
                "skills",
            )
    for field in ("employment", "projects", "achievements"):
        skills = [skill for skill in terms(fields.get("skills", "")) if normalized(skill) in topic]
        for line in fields.get(field, "").splitlines():
            if any(normalized(skill) in normalized(line) for skill in skills):
                return answer(line, field)
    return {
        "answer": "",
        "evidence": None,
        "message": "No matching reviewed fact was found. Add your own answer.",
    }


def answer(value: str, field: str) -> dict:
    value = value.strip()
    if not value or len(value) > 2000:
        return {
            "answer": "",
            "evidence": None,
            "message": "Review the source field and write a shorter answer.",
        }
    return {
        "answer": value,
        "evidence": field,
        "message": f"Draft based on reviewed {field.replace('_', ' ')}. Check it before saving.",
    }
