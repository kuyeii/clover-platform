package cryptoenvelope

import (
	"encoding/hex"
	"testing"
)

func TestEncryptDecryptRoundtrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	plain := []byte("hello secret world")
	env, err := Encrypt(plain, key)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	out, err := Decrypt(env, key)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if string(out) != string(plain) {
		t.Fatalf("roundtrip mismatch: got %q want %q", string(out), string(plain))
	}
}

func TestDecryptInvalidMagic(t *testing.T) {
	key := make([]byte, 16)
	for i := range key {
		key[i] = byte(i + 1)
	}
	plain := []byte("x")
	env, err := Encrypt(plain, key)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	// corrupt magic
	copy(env[0:4], []byte("BAD!"))
	if _, err := Decrypt(env, key); err == nil {
		t.Fatalf("expected error for invalid magic")
	}
}

func TestDecryptInvalidNonceLen(t *testing.T) {
	key := make([]byte, 16)
	for i := range key {
		key[i] = byte(i + 1)
	}
	plain := []byte("x")
	env, err := Encrypt(plain, key)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	// set nonceLen to 11
	env[4] = byte(11)
	if _, err := Decrypt(env, key); err == nil {
		t.Fatalf("expected error for invalid nonce len")
	}
}

func TestInvalidKeyLength(t *testing.T) {
	// key length 10 invalid
	key := make([]byte, 10)
	plain := []byte("x")
	if _, err := Encrypt(plain, key); err == nil {
		t.Fatalf("expected error for invalid key length on encrypt")
	}
	// create valid envelope and attempt decrypt with invalid key
	validKey := make([]byte, 16)
	for i := range validKey {
		validKey[i] = byte(i + 1)
	}
	env, err := Encrypt(plain, validKey)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if _, err := Decrypt(env, key); err == nil {
		t.Fatalf("expected error for invalid key length on decrypt")
	}
	// test DecodeKeyHex rejects bad lengths
	_, err = DecodeKeyHex(hex.EncodeToString(key))
	if err == nil {
		t.Fatalf("expected DecodeKeyHex to reject invalid length")
	}
}


