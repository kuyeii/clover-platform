from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

UserRole = Literal["admin", "operator", "viewer"]


class LoginInput(BaseModel):
    account: str = Field(min_length=1)
    password: str = Field(min_length=1)


class ChangePasswordInput(BaseModel):
    currentPassword: str = Field(min_length=1)
    newPassword: str = Field(min_length=1)


class UserCreateInput(BaseModel):
    name: str = Field(min_length=1)
    account: str = Field(min_length=1)
    password: str = Field(min_length=1)
    role: UserRole = "operator"
    appPermissions: list[str] = Field(default_factory=list)


class UserUpdateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    account: str | None = None
    password: str | None = None
    role: UserRole | None = None
    enabled: bool | None = None
    appPermissions: list[str] | None = None


class EnterAppInput(BaseModel):
    confirmedConflict: bool = False
