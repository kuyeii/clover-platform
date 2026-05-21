from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

UserRole = Literal["admin", "operator", "viewer"]


class LoginInput(BaseModel):
    account: str
    password: str


class ChangePasswordInput(BaseModel):
    currentPassword: str
    newPassword: str


class UserCreateInput(BaseModel):
    name: str
    account: str
    password: str
    role: UserRole = "operator"
    appPermissions: list[str] | None = None


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
