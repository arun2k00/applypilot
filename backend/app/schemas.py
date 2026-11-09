from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator


class SettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    workspace_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]
    timezone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, timezone: str) -> str:
        try:
            ZoneInfo(timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Enter an IANA timezone, such as UTC or Asia/Kolkata.") from None
        return timezone
