# excel_encryptor_py

一个独立的小工具：用 **hex 密钥**对 Excel（或任意文件）做 AES-GCM 加密，输出平台侧后端可解密的 `.enc` 文件。

## 封装格式
输出 bytes =

- MAGIC(4 bytes) = `BC01`
- nonceLen(1 byte) = `12`
- nonce(12 bytes)
- ciphertext（AES-GCM 输出，包含 tag）

与后端 `internal/cryptoenvelope` 兼容。

## 安装
Python 3.9+，依赖 `cryptography`：

```bash
pip install -r requirements.txt
```

## 加密
```bash
python encryptor.py encrypt --in bank.xlsx --out bank.xlsx.enc --keyhex 001122...
```

## 解密（自测用）
```bash
python encryptor.py decrypt --in bank.xlsx.enc --out bank.xlsx --keyhex 001122...
```
