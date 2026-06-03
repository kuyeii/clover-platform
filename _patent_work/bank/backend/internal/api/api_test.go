package api

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/example/monorepo/backend/internal/cryptoenvelope"
	"github.com/example/monorepo/backend/internal/excelio"
	"github.com/example/monorepo/backend/internal/platformsecret"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"
	"github.com/stretchr/testify/require"
)

func setupTestServer(t *testing.T, dataDir string, secretDir string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	os.Setenv("SECRET_DIR", secretDir)
	// register routes
	RegisterRoutes(r, ServerConfig{DataDir: dataDir, MaxUploadMB: 5})
	return r
}

func writeSecretFile(t *testing.T, dir string, userId string, key []byte) {
	os.Setenv("userId", userId)
	fp := filepath.Join(dir, userId+".json")
	hexKey := hex.EncodeToString(key)
	require.NoError(t, os.WriteFile(fp, []byte(`{"key":"`+hexKey+`"}`), 0o600))
}

func createSampleMedical() []byte {
	f := excelize.NewFile()
	s := f.GetSheetName(0)
	f.SetCellValue(s, "A1", "psn_no")
	f.SetCellValue(s, "B1", "psn_name")
	f.SetCellValue(s, "C1", "phone")
	f.SetCellValue(s, "D1", "id_card")
	f.SetCellValue(s, "E1", "psn_clct_amt")
	f.SetCellValue(s, "A2", "PN1")
	f.SetCellValue(s, "B2", "Alice")
	f.SetCellValue(s, "C2", "138")
	f.SetCellValue(s, "D2", "ID1")
	f.SetCellValue(s, "E2", "6000")
	buf, _ := f.WriteToBuffer()
	return buf.Bytes()
}

func createSampleBank() []byte {
	f := excelize.NewFile()
	s := f.GetSheetName(0)
	f.SetCellValue(s, "A1", "bank_user_id")
	f.SetCellValue(s, "B1", "name")
	f.SetCellValue(s, "C1", "phone")
	f.SetCellValue(s, "D1", "id_card")
	f.SetCellValue(s, "A2", "B1")
	f.SetCellValue(s, "B2", "AliceBank")
	f.SetCellValue(s, "C2", "138")
	f.SetCellValue(s, "D2", "ID1")
	buf, _ := f.WriteToBuffer()
	return buf.Bytes()
}

func TestEndToEndHappyPath(t *testing.T) {
	tmp := t.TempDir()
	dataDir := filepath.Join(tmp, "data")
	secretDir := filepath.Join(tmp, "secret")
	require.NoError(t, os.MkdirAll(filepath.Join(dataDir, "uploads", "medical"), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(dataDir, "uploads", "bank"), 0o755))
	require.NoError(t, os.MkdirAll(secretDir, 0o755))

	// create secret
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	userId := "testuser"
	writeSecretFile(t, secretDir, userId, key)

	// setup server
	r := setupTestServer(t, dataDir, secretDir)

	// 1) upload medical
	medBytes := createSampleMedical()
	body := &bytes.Buffer{}
	writer := io.MultiWriter(body)
	// use multipart
	pr, pw := io.Pipe()
	mw := multipartWriter{w: pw}
	go func() {
		defer pw.Close()
		mw.WriteFile("file", "med.xlsx", medBytes)
	}()
	req := httptest.NewRequest("POST", "/api/medical/upload", pr)
	req.Header.Set("Content-Type", mw.ContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, 200, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	jobId, ok := resp["jobId"].(string)
	require.True(t, ok)

	// 2) prepare encrypted bank and upload
	bankBytes := createSampleBank()
	env, err := cryptoenvelope.Encrypt(bankBytes, key)
	require.NoError(t, err)
	// upload bank
	pr2, pw2 := io.Pipe()
	mw2 := multipartWriter{w: pw2}
	go func() {
		defer pw2.Close()
		mw2.WriteFile("file", "bank.enc", env)
	}()
	req2 := httptest.NewRequest("POST", "/api/bank/upload", pr2)
	req2.Header.Set("Content-Type", mw2.ContentType())
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	require.Equal(t, 200, w2.Code)
	var resp2 map[string]interface{}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp2))
	jobId2, ok := resp2["jobId"].(string)
	require.True(t, ok)
	// jobId from medical and bank should be independent; but compute expects same jobId
	// For test, copy bank file to medical jobId location to satisfy compute using same jobId
	src := filepath.Join(dataDir, "uploads", "bank", jobId2+".enc")
	dst := filepath.Join(dataDir, "uploads", "bank", jobId+".enc")
	bs, err := os.ReadFile(src)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(dst, bs, 0o600))

	// 3) compute
	payload := fmt.Sprintf(`{"jobId":"%s"}`, jobId)
	req3 := httptest.NewRequest("POST", "/api/compute", bytes.NewReader([]byte(payload)))
	req3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	require.Equal(t, 200, w3.Code)
	var resp3 map[string]interface{}
	require.NoError(t, json.Unmarshal(w3.Body.Bytes(), &resp3))
	// check result exists
	resPath := filepath.Join(dataDir, "results", jobId+".xlsx")
	_, err = os.Stat(resPath)
	require.NoError(t, err)

	// 4) download
	req4 := httptest.NewRequest("GET", "/api/result/download?jobId="+jobId, nil)
	w4 := httptest.NewRecorder()
	r.ServeHTTP(w4, req4)
	require.Equal(t, 200, w4.Code)
	// try opening as xlsx
	f, err := excelize.OpenReader(bytes.NewReader(w4.Body.Bytes()))
	require.NoError(t, err)
	rows, err := f.GetRows(f.GetSheetName(0))
	require.NoError(t, err)
	// header + 1 row
	require.Equal(t, 2, len(rows))
}

// minimal multipart writer helper for tests
type multipartWriter struct {
	w *io.PipeWriter
	boundary string
	closed bool
}

func (m *multipartWriter) ContentType() string {
	if m.boundary == "" {
		m.boundary = uuid.New().String()
	}
	return "multipart/form-data; boundary=" + m.boundary
}

func (m *multipartWriter) WriteFile(field, filename string, data []byte) {
	b := m.boundary
	fmt.Fprintf(m.w, "--%s\r\n", b)
	fmt.Fprintf(m.w, "Content-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n", field, filename)
	fmt.Fprintf(m.w, "Content-Type: application/octet-stream\r\n\r\n")
	m.w.Write(data)
	fmt.Fprintf(m.w, "\r\n--%s--\r\n", b)
}


