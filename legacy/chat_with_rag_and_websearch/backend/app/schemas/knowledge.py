from pydantic import BaseModel, Field


class CreateTextDocumentRequest(BaseModel):
    """用户仅提交名称与正文；其余索引参数由服务端按当前知识库约定填充。"""

    name: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=2_000_000)
