package platformsecret

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// LoadDataKeyHex reads env userId and returns key hex string from /secret/<userId>.json
// For local tests, env SECRET_DIR can override the base directory (defaults to /secret).
func LoadDataKeyHex() (string, error) {
	userId := os.Getenv("userId")
	if userId == "" {
		return "", errors.New("userId env is not set")
	}
	base := os.Getenv("SECRET_DIR")
	if base == "" {
		base = "/secret"
	}
	fp := filepath.Join(base, userId+".json")
	b, err := os.ReadFile(fp)
	if err != nil {
		return "", fmt.Errorf("failed to read secret file: %w", err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		return "", fmt.Errorf("invalid secret json: %w", err)
	}
	v, ok := m["key"]
	if !ok {
		return "", errors.New("secret json missing key field")
	}
	ks, ok := v.(string)
	if !ok {
		return "", errors.New("secret key field is not a string")
	}
	return ks, nil
}


