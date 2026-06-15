package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/example/monorepo/backend/internal/cryptoenvelope"
	"github.com/example/monorepo/backend/internal/excelio"
	"github.com/example/monorepo/backend/internal/platformsecret"
	"github.com/example/monorepo/backend/internal/scoring"
)

type ServerConfig struct {
	DataDir     string
	MaxUploadMB int64
}

func RegisterRoutes(r *gin.Engine, cfg ServerConfig) {
	// Ensure base dirs
	ensureDirs(cfg.DataDir)

	// set max multipart memory
	r.MaxMultipartMemory = cfg.MaxUploadMB * 1024 * 1024

	api := r.Group("/api")
	{
		api.POST("/medical/upload", handleMedicalUpload(cfg))
		api.POST("/bank/upload", handleBankUpload(cfg))
		api.POST("/compute", handleCompute(cfg))
		api.GET("/result/download", handleDownload(cfg))
	}
}

func ensureDirs(base string) {
	paths := []string{
		filepath.Join(base, "uploads", "medical"),
		filepath.Join(base, "uploads", "bank"),
		filepath.Join(base, "tmp"),
		filepath.Join(base, "results"),
	}
	for _, p := range paths {
		_ = os.MkdirAll(p, 0o755)
	}
}

func jsonError(c *gin.Context, code int, errCode string, message string) {
	c.JSON(code, gin.H{"ok": false, "errorCode": errCode, "message": message})
}

func handleMedicalUpload(cfg ServerConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		file, err := c.FormFile("file")
		if err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_MISSING_FILE", "file is required")
			return
		}
		if file.Size > cfg.MaxUploadMB*1024*1024 {
			jsonError(c, http.StatusRequestEntityTooLarge, "ERR_FILE_TOO_LARGE", "file too large")
			return
		}
		// allow client to supply jobId to save under same identifier (helpful for pairing uploads)
		jobId := c.PostForm("jobId")
		if jobId == "" {
			jobId = uuid.New().String()
		}
		dst := filepath.Join(cfg.DataDir, "uploads", "medical", jobId+".xlsx")
		if err := c.SaveUploadedFile(file, dst); err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_SAVE_FAILED", "failed to save file")
			return
		}
		// count rows using excelio
		f, err := os.Open(dst)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_READ_SAVED", "failed to read saved file")
			return
		}
		defer f.Close()
		meds, err := excelio.ReadMedicalXLSX(f)
		if err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_PARSE_EXCEL", "failed to parse excel")
			return
		}
		c.JSON(200, gin.H{"ok": true, "jobId": jobId, "rowsCount": len(meds)})
	}
}

func handleBankUpload(cfg ServerConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		file, err := c.FormFile("file")
		if err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_MISSING_FILE", "file is required")
			return
		}
		if file.Size > cfg.MaxUploadMB*1024*1024 {
			jsonError(c, http.StatusRequestEntityTooLarge, "ERR_FILE_TOO_LARGE", "file too large")
			return
		}
		// allow client to supply jobId to save under same identifier (helpful for pairing uploads)
		jobId := c.PostForm("jobId")
		if jobId == "" {
			jobId = uuid.New().String()
		}
		dst := filepath.Join(cfg.DataDir, "uploads", "bank", jobId+".enc")
		if err := c.SaveUploadedFile(file, dst); err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_SAVE_FAILED", "failed to save file")
			return
		}
		c.JSON(200, gin.H{"ok": true, "jobId": jobId})
	}
}

type computeRequest struct {
	JobId string `json:"jobId"`
}

func handleCompute(cfg ServerConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req computeRequest
		if err := c.BindJSON(&req); err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_INVALID_JSON", "invalid request body")
			return
		}
		if req.JobId == "" {
			jsonError(c, http.StatusBadRequest, "ERR_MISSING_JOBID", "jobId required")
			return
		}
		start := time.Now()

		// read medical file
		medPath := filepath.Join(cfg.DataDir, "uploads", "medical", req.JobId+".xlsx")
		medF, err := os.Open(medPath)
		if err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_MEDICAL_NOT_FOUND", "medical upload not found")
			return
		}
		defer medF.Close()
		meds, err := excelio.ReadMedicalXLSX(medF)
		if err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_PARSE_MEDICAL", "failed to parse medical excel")
			return
		}

		// read bank encrypted file
		bankPath := filepath.Join(cfg.DataDir, "uploads", "bank", req.JobId+".enc")
		enc, err := os.ReadFile(bankPath)
		if err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_BANK_NOT_FOUND", "bank upload not found")
			return
		}

		// load key from platform secret
		keyHex, err := platformsecret.LoadDataKeyHex()
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_LOAD_KEY", "failed to load data key")
			return
		}
		key, err := cryptoenvelope.DecodeKeyHex(keyHex)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_INVALID_KEY", "invalid data key")
			return
		}

		// decrypt in memory
		bankPlain, err := cryptoenvelope.Decrypt(enc, key)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_DECRYPT", "failed to decrypt bank file")
			return
		}

		// parse bank xlsx from bytes
		banks, err := excelio.ReadBankXLSX(bytes.NewReader(bankPlain))
		if err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_PARSE_BANK", "failed to parse bank xlsx")
			return
		}

		// scoring
		ctx := scoring.BuildContext(meds)
		rules := []scoring.Rule{scoring.PhoneMatchRule{}, scoring.MedicalBaseRule{}}
		results, err := scoring.ScoreAll(ctx, banks, rules)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_SCORE", "scoring failed")
			return
		}

		// write result to DATA_DIR/results/<jobId>.xlsx
		resPath := filepath.Join(cfg.DataDir, "results", req.JobId+".xlsx")
		if err := func() error {
			tmpf, err := os.CreateTemp(filepath.Join(cfg.DataDir, "tmp"), "result-*.xlsx")
			if err != nil {
				return err
			}
			defer func() {
				name := tmpf.Name()
				tmpf.Close()
				_ = os.Remove(name)
			}()
			if err := excelio.WriteResultXLSX(tmpf, results); err != nil {
				return err
			}
			// ensure data is flushed
			if err := tmpf.Sync(); err != nil {
				// ignore
			}
			if err := os.Rename(tmpf.Name(), resPath); err != nil {
				// try copy fallback
				bs, err := os.ReadFile(tmpf.Name())
				if err != nil {
					return err
				}
				if err := os.WriteFile(resPath, bs, 0o644); err != nil {
					return err
				}
			}
			return nil
		}(); err != nil {
			jsonError(c, http.StatusInternalServerError, "ERR_WRITE_RESULT", "failed to write result")
			return
		}

		elapsed := time.Since(start).Milliseconds()
		c.JSON(200, gin.H{"ok": true, "jobId": req.JobId, "resultRows": len(results), "elapsedMs": elapsed})
	}
}

func handleDownload(cfg ServerConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		jobId := c.Query("jobId")
		if jobId == "" {
			jsonError(c, http.StatusBadRequest, "ERR_MISSING_JOBID", "jobId required")
			return
		}
		resPath := filepath.Join(cfg.DataDir, "results", jobId+".xlsx")
		if _, err := os.Stat(resPath); err != nil {
			jsonError(c, http.StatusBadRequest, "ERR_RESULT_NOT_FOUND", "result not found")
			return
		}
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.xlsx\"", jobId))
		c.File(resPath)
	}
}


