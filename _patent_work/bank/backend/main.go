package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/example/monorepo/backend/internal/api"
)

//go:embed dist/*
var staticFiles embed.FS

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// register API routes under /api
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}
	maxMB := int64(20)
	if v := os.Getenv("MAX_UPLOAD_MB"); v != "" {
		if m, err := strconv.ParseInt(v, 10, 64); err == nil && m > 0 {
			maxMB = m
		}
	}
	api.RegisterRoutes(router, api.ServerConfig{DataDir: dataDir, MaxUploadMB: maxMB})

	// Serve embedded static files from dist
	sub, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		log.Fatalf("failed to access embedded dist: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))

	// Try to serve static assets; fallback to index.html for SPA routing
	router.NoRoute(func(c *gin.Context) {
		reqPath := path.Clean(c.Request.URL.Path)
		// try to open requested path in embedded fs
		if f, err := sub.Open(reqPath); err == nil {
			f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		// fallback to index.html
		f, err := sub.Open("index.html")
		if err != nil {
			c.String(500, "index not found")
			return
		}
		defer f.Close()
		info, _ := f.Stat()
		c.DataFromReader(200, info.Size(), "text/html", f, nil)
	})

	addr := ":" + port
	log.Printf("listening %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}


