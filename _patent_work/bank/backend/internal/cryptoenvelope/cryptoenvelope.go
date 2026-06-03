package cryptoenvelope

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

const magic = "BC01"
const nonceLen = 12

// Encrypt builds envelope = MAGIC(4) + nonceLen(1) + nonce + ciphertext
func Encrypt(plaintext []byte, key []byte) ([]byte, error) {
	if !(len(key) == 16 || len(key) == 24 || len(key) == 32) {
		return nil, fmt.Errorf("invalid key length: %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create gcm: %w", err)
	}
	nonce := make([]byte, nonceLen)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	out := make([]byte, 0, 4+1+nonceLen+len(ciphertext))
	out = append(out, []byte(magic)...)
	out = append(out, byte(nonceLen))
	out = append(out, nonce...)
	out = append(out, ciphertext...)
	return out, nil
}

// Decrypt parses envelope and returns plaintext
func Decrypt(envelope []byte, key []byte) ([]byte, error) {
	if len(envelope) < 4+1+nonceLen {
		return nil, errors.New("envelope too short")
	}
	if string(envelope[0:4]) != magic {
		return nil, errors.New("invalid magic")
	}
	nl := int(envelope[4])
	if nl != nonceLen {
		return nil, fmt.Errorf("invalid nonce length: %d", nl)
	}
	if len(envelope) < 4+1+nl {
		return nil, errors.New("envelope truncated")
	}
	nonce := envelope[5 : 5+nl]
	ciphertext := envelope[5+nl:]

	if !(len(key) == 16 || len(key) == 24 || len(key) == 32) {
		return nil, fmt.Errorf("invalid key length: %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create gcm: %w", err)
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		// Do not expose internal plaintext or key in error
		return nil, fmt.Errorf("decryption failed: %w", err)
	}
	return plaintext, nil
}

// Helper to decode hex key (used by CLI/tests)
func DecodeKeyHex(hexStr string) ([]byte, error) {
	b, err := hex.DecodeString(hexStr)
	if err != nil {
		return nil, fmt.Errorf("invalid hex key: %w", err)
	}
	if !(len(b) == 16 || len(b) == 24 || len(b) == 32) {
		return nil, fmt.Errorf("invalid key length: %d", len(b))
	}
	return b, nil
}


