import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

Percent = Annotated[int, Field(strict=True, ge=0, le=100)]


class MatchWeights(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Percent = 25
    skills: Percent = 20
    experience: Percent = 15
    seniority: Percent = 15
    industry: Percent = 10
    location: Percent = 10
    compensation: Percent = 5

    @model_validator(mode="after")
    def total_is_one_hundred(self):
        if sum(self.model_dump().values()) != 100:
            raise ValueError("Match weights must add up to 100.")
        return self


class MatchPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weights: MatchWeights = Field(default_factory=MatchWeights)
    recommended_score: Percent = 70
    excellent_score: Percent = 85
    minimum_evidence: Percent = 20

    @model_validator(mode="after")
    def valid_thresholds(self):
        if self.excellent_score < self.recommended_score:
            raise ValueError("Excellent score must be at least the recommended score.")
        return self

    def meets(self, result: dict, threshold: int) -> bool:
        score = result["score"]
        return (
            score is not None and score >= threshold and result["evidence"] >= self.minimum_evidence
        )


DEFAULT_POLICY = MatchPolicy()


def match_policy(criteria: dict) -> MatchPolicy:
    value = criteria.get("match_policy")
    return MatchPolicy.model_validate(value) if value else DEFAULT_POLICY


def excluded_company(company: str, criteria: dict) -> bool:
    return normalized(company) in {
        normalized(name) for name in terms(criteria.get("excluded_companies", ""))
    }


def closed(job, today: str) -> bool:
    closing = job.details.get("closes_on")
    return bool(closing and closing < today)


def terms(text: str) -> list[str]:
    return list(dict.fromkeys(part.strip() for part in re.split(r"[,;\n]", text) if part.strip()))


def normalized(text: str) -> str:
    return " ".join(text.casefold().split())


def years(text: str) -> float | None:
    match = re.fullmatch(r"(\d{1,2}(?:\.\d{1,2})?)\s*(?:years?|yrs?)?\+?", text.strip().lower())
    return float(match[1]) if match else None


def evaluate(job, profile: dict, criteria: dict, policy: MatchPolicy | None = None) -> dict:
    dimensions = []
    policy = policy or match_policy(criteria)
    weights = policy.weights

    def add(label: str, weight: int, value: float | None, reason: str):
        dimensions.append({"label": label, "weight": weight, "value": value, "reason": reason})

    titles = terms(criteria.get("titles", ""))
    role = normalized(job.title)
    role_words = set(role.split())
    role_match = max(
        (
            len(set(normalized(title).split()) & role_words) / len(normalized(title).split())
            for title in titles
        ),
        default=None,
    )
    add(
        "Role",
        weights.role,
        role_match,
        "Saved titles compared with the listing title."
        if titles
        else "Save desired titles to evaluate role relevance.",
    )
    required = terms(job.details.get("skills", ""))
    verified = {normalized(skill) for skill in terms(profile.get("skills", ""))}
    matched = [skill for skill in required if normalized(skill) in verified]
    gaps = [skill for skill in required if normalized(skill) not in verified]
    skill_match = len(matched) / len(required) if required and verified else None
    add(
        "Required skills",
        weights.skills,
        skill_match,
        "Based on the reviewed skills inventory."
        if skill_match is not None
        else "Required skills or candidate skills are missing.",
    )
    minimum = job.details.get("experience")
    candidate_years = years(profile.get("total_experience", ""))
    exp = (
        float(candidate_years >= minimum)
        if candidate_years is not None and minimum is not None
        else None
    )
    add(
        "Experience",
        weights.experience,
        exp,
        "Compared with the listing's stated minimum."
        if exp is not None
        else "Candidate experience or listing minimum is unspecified.",
    )
    for field, label in (("seniority", "Seniority"), ("industry", "Industry")):
        expected = {normalized(part) for part in terms(criteria.get(field, ""))}
        observed = normalized(job.details.get(field, ""))
        add(
            label,
            getattr(weights, field),
            float(observed in expected) if expected and observed else None,
            "Compared with saved preferences."
            if expected and observed
            else "Preference or listing detail is unspecified.",
        )
    expected_place = {normalized(part) for part in terms(criteria.get("locations", ""))}
    place = normalized(job.details.get("location", ""))
    arrangement = criteria.get("arrangement", "")
    actual = job.details.get("arrangement", "")
    location_checks = []
    if expected_place and place:
        location_checks.append(any(preference in place for preference in expected_place))
    if arrangement and actual:
        location_checks.append(arrangement == actual)
    add(
        "Location and arrangement",
        weights.location,
        sum(location_checks) / len(location_checks) if location_checks else None,
        "Compared with the location and work arrangement preferences available.",
    )
    expected_pay = criteria.get("min_salary")
    offered_pay = job.details.get("max_salary")
    currency = normalized(criteria.get("currency", ""))
    same_currency = currency and currency == normalized(job.details.get("currency", ""))
    pay = (
        float(offered_pay >= expected_pay)
        if same_currency and expected_pay is not None and offered_pay is not None
        else None
    )
    add(
        "Compensation",
        weights.compensation,
        pay,
        "Compared in the same currency."
        if pay is not None
        else "Comparable compensation information is missing.",
    )
    known = [item for item in dimensions if item["value"] is not None]
    evidence = sum(item["weight"] for item in known)
    score = (
        round(sum(item["weight"] * item["value"] for item in known) / evidence * 100)
        if evidence
        else None
    )
    return {
        "score": score,
        "evidence": evidence,
        "dimensions": dimensions,
        "matched_skills": matched,
        "unconfirmed_skills": gaps,
    }
