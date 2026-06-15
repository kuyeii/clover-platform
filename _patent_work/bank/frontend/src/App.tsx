import React, { useEffect, useState } from "react";
import axios from "axios";

export default function App() {
  const [medicalFileName, setMedicalFileName] = useState<string | null>(null);
  const [medicalRowsCount, setMedicalRowsCount] = useState<number | null>(null);
  const [medicalJobId, setMedicalJobId] = useState<string | null>(null);

  const [bankFileName, setBankFileName] = useState<string | null>(null);
  const [bankJobId, setBankJobId] = useState<string | null>(null);

  const [computing, setComputing] = useState(false);
  const [resultRows, setResultRows] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    const mId = localStorage.getItem("medicalJobId");
    const bId = localStorage.getItem("bankJobId");
    const mName = localStorage.getItem("medicalFileName");
    const bName = localStorage.getItem("bankFileName");
    const rows = localStorage.getItem("medicalRowsCount");
    if (mId) setMedicalJobId(mId);
    if (bId) setBankJobId(bId);
    if (mName) setMedicalFileName(mName);
    if (bName) setBankFileName(bName);
    if (rows) setMedicalRowsCount(Number(rows));
  }, []);

  useEffect(() => {
    if (medicalJobId) localStorage.setItem("medicalJobId", medicalJobId);
    if (bankJobId) localStorage.setItem("bankJobId", bankJobId);
  }, [medicalJobId, bankJobId]);

  const api = axios.create({ baseURL: "/api" });

  async function uploadMedical(file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      // if we already have a bank jobId, reuse it so both uploads pair to same job
      if (bankJobId) {
        fd.append("jobId", bankJobId);
      }
      const resp = await api.post("/medical/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (resp.data && resp.data.ok) {
        setMedicalFileName(file.name);
        setMedicalRowsCount(resp.data.rowsCount || 0);
        setMedicalJobId(resp.data.jobId);
        localStorage.setItem("medicalFileName", file.name);
        localStorage.setItem("medicalRowsCount", String(resp.data.rowsCount || 0));
        alert("医保上传成功");
      } else {
        alert("医保上传失败");
      }
    } catch (err: any) {
      console.error(err);
      alert("医保上传出错: " + (err?.response?.data?.message || err.message));
    }
  }

  async function uploadBank(file: File) {
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      // if we already have a bank jobId, reuse it so both uploads pair to same job
      if (bankJobId) {
        fd.append("jobId", bankJobId);
      }
      // if we have medicalJobId, send it so backend can save bank under same jobId
      if (medicalJobId) {
        fd.append("jobId", medicalJobId);
      }
      const resp = await api.post("/bank/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (resp.data && resp.data.ok) {
        setBankFileName(file.name);
        setBankJobId(resp.data.jobId);
        localStorage.setItem("bankFileName", file.name);
        localStorage.setItem("bankJobId", resp.data.jobId);
        alert("银行文件上传成功");
      } else {
        alert("银行上传失败");
      }
    } catch (err: any) {
      console.error(err);
      alert("银行上传出错: " + (err?.response?.data?.message || err.message));
    }
  }

  async function doCompute() {
    if (!medicalJobId || !bankJobId) {
      alert("需要先上传医保和银行文件");
      return;
    }
    if (medicalJobId !== bankJobId) {
      alert("医保与银行文件不属于同一个任务，请重新上传（建议先上传任意一个文件，再上传另一个文件）");
      return;
    }
    const jobId = medicalJobId;
    setComputing(true);
    setResultRows(null);
    setElapsedMs(null);
    try {
      const resp = await api.post("/compute", { jobId });
      if (resp.data && resp.data.ok) {
        setResultRows(resp.data.resultRows || 0);
        setElapsedMs(resp.data.elapsedMs || 0);
        alert("计算完成");
      } else {
        alert("计算失败");
      }
    } catch (err: any) {
      console.error(err);
      alert("计算出错: " + (err?.response?.data?.message || err.message));
    } finally {
      setComputing(false);
    }
  }

  function downloadResult() {
    if (!medicalJobId || !bankJobId || medicalJobId !== bankJobId) {
      alert("还没有可下载的结果");
      return;
    }
    const jobId = medicalJobId;
    // trigger browser download
    window.location.href = `/api/result/download?jobId=${encodeURIComponent(jobId)}`;
  }

  return (
    <div style={{ padding: 24, fontFamily: "Arial, Helvetica, sans-serif" }}>
      <h1>PLASMA Demo</h1>
      <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <div style={{ padding: 12, background: "white", borderRadius: 6 }}>
          <h3>医保上传 (明文 Excel)</h3>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadMedical(f);
            }}
          />
          <div style={{ marginTop: 8 }}>
            <strong>文件:</strong> {medicalFileName || "未上传"}
          </div>
          <div>
            <strong>行数:</strong> {medicalRowsCount ?? "-"}
          </div>
          <div>
            <strong>jobId:</strong> {medicalJobId || "-"}
          </div>
        </div>

        <div style={{ padding: 12, background: "white", borderRadius: 6 }}>
          <h3>银行上传 (加密文件)</h3>
          <input
            type="file"
            accept=".enc,application/octet-stream"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadBank(f);
            }}
          />
          <div style={{ marginTop: 8 }}>
            <strong>文件:</strong> {bankFileName || "未上传"}
          </div>
          <div>
            <strong>jobId:</strong> {bankJobId || "-"}
          </div>
        </div>

        <div style={{ padding: 12, background: "white", borderRadius: 6 }}>
          <h3>计算</h3>
          <button disabled={computing || !medicalJobId || !bankJobId || medicalJobId !== bankJobId} onClick={() => doCompute()}
          >
            {computing ? "计算中..." : "计算得分"}
          </button>
          <div style={{ marginTop: 8 }}>
            <strong>结果行数:</strong> {resultRows ?? "-"}
          </div>
          <div>
            <strong>耗时(ms):</strong> {elapsedMs ?? "-"}
          </div>
        </div>

        <div style={{ padding: 12, background: "white", borderRadius: 6 }}>
          <h3>下载结果</h3>
          <button disabled={resultRows === null} onClick={() => downloadResult()}>
            下载结果 Excel
          </button>
        </div>
      </div>
    </div>
  );
}


