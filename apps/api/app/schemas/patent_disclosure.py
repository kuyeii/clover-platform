from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


MaterialType = Literal["source", "reference", "existing"]
OutputFormat = Literal["md", "docx"]


class PatentCaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    technicalTopic: str = ""
    applicant: str = ""
    projectName: str = ""
    description: str = ""
    anonymize: bool = True


class GenerateDisclosureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outputFormats: list[OutputFormat] = Field(default_factory=lambda: ["md", "docx"])
    includeMermaid: bool = True
    renderMermaidPng: bool = True
    anonymize: bool = True
    extraInstruction: str = ""

