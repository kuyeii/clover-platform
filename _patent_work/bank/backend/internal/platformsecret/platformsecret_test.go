package platformsecret

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDataKeyHex(t *testing.T) {
	dir := t.TempDir()
	userId := "testuser"
	os.Setenv("userId", userId)
	os.Setenv("SECRET_DIR", dir)
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	hexKey := hex.EncodeToString(key)
	fp := filepath.Join(dir, userId+".json")
	if err := os.WriteFile(fp, []byte(`{"key":"`+hexKey+`"}`), 0o600); err != nil {
		t.Fatalf("write secret failed: %v", err)
	}
	got, err := LoadDataKeyHex()
	if err != nil {
		t.Fatalf("LoadDataKeyHex failed: %v", err)
	}
	if got != hexKey {
		t.Fatalf("key mismatch")
	}
}

func TestLoadDataKeyHexMissingUser(t *testing.T) {
	os.Unsetenv("userId")
	os.Unsetenv("SECRET_DIR")
	if _, err := LoadDataKeyHex(); err == nil {
		t.Fatalf("expected error when userId missing")
	}
}


