# PLASMA 机密计算平台部署说明（本项目）

本项目是一个单容器 Web 系统（前端 + Go 后端），用于：
- 上传 **医保明文 Excel**（xlsx）
- 上传 **银行加密文件**（由数据提供方用数据密钥加密生成）
- 在 TEE 内读取 `/secret/<userId>.json` 的 `key`，解密银行文件并计算得分
- 生成结果 Excel（xlsx）并提供下载

---

## 一、你需要准备什么

### 1) 数据密钥（数据提供方创建）
平台「密钥管理」里创建 **数据密钥**（或更新已有密钥）。
- 该密钥会在工作负载运行时，以文件形式挂载在 TEE 内：`/secret/<userId>.json`
- 文件里包含字段 `key`（hex 字符串）

> 注意：部署工作负载时需要填写 env `userId`，这个 userId 是 **数据提供方**的 userId（对应 `/secret/<userId>.json`）。

### 2) 数据卷（数据使用方创建）
平台「数据卷管理」创建数据卷，并在部署工作负载时挂载到容器路径（推荐 `/data`）。
本项目会把上传文件与结果文件写入：
- `/data/uploads/...`
- `/data/results/...`

---

## 二、镜像构建 & 加密上传（按平台要求）

### 方式 A：普通镜像（不加密）
在你的构建机上：

```bash
docker build -t bank-score:latest .
```

然后按平台 UI 上传镜像即可。

### 方式 B：加密镜像（推荐）
1. 在平台「密钥管理」创建 **镜像密钥**（与数据密钥不同）。
2. 在构建机生成镜像 tar，并加密：

```bash
docker save bank-score:latest -o bank-score.tar

# 以下示例使用平台提供的 imagetool
# 用镜像密钥对镜像进行加密，输出 *.encrypted
./imagetool encrypt -t bank-score:latest -k <镜像密钥值>
```

3. 将输出的 `*.encrypted` 上传到平台「镜像管理」。

> 如平台开启了“验签模式”，还需要先用 imagetool sign 生成 signature.bin 并一并上传。

---

## 三、在平台创建工作负载（关键配置）

在平台「工作负载管理」创建工作负载，关键配置如下：

### 1) 端口映射
- 容器端口：`8080`
- 外部访问端口：按需配置

### 2) 环境变量
至少需要：

- `userId=<数据提供方userId>`  （必须）
- `PORT=8080`（可选，默认 8080）
- `DATA_DIR=/data`（可选，默认 /data）
- `MAX_UPLOAD_MB=20`（可选，默认 20）

### 3) 挂载数据卷
- 将数据卷挂载到：`/data`（或你自己选择的路径，但必须与 `DATA_DIR` 一致）

---

## 四、运行后如何使用

访问部署后的 Web 页面：

1. 上传医保明文 xlsx（可以是多 sheet 文件，本项目会自动选择含医保列的 sheet）
2. 上传银行加密文件（加密文件是“加密后的 xlsx bytes”，不是明文 xlsx）
3. 点击「计算」
4. 点击「下载结果」

---

## 五、本地开发 / 自测（不依赖平台）

### 1) 本地模拟 /secret
创建本地目录，例如 `./secret/`，放一个 `test-user.json`：

```json
{"key":"00112233445566778899aabbccddeeff"}
```

启动服务前设置：

```bash
export userId=test-user
export SECRET_DIR=./secret   # 仅本地用；平台不需要
export DATA_DIR=./data
make dev
```

### 2) 生成银行加密文件
项目内自带 Go 加密工具：

```bash
cd backend
go run ./cmd/bank-encryptor -in /path/to/bank.xlsx -out /path/to/bank.xlsx.enc -keyhex 001122...
```

或使用我在仓库根目录额外提供的 `excel_encryptor_py/`（Python 版本）进行加密。
