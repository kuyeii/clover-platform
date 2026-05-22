let memoryAccessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

export function clearAccessToken(): void {
  memoryAccessToken = null;
}

// 第 10-A 只保留内存 token 占位。第 10-B 迁移 Portal 登录时再接入真实 token 生命周期管理。
