package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"os"

	"github.com/example/monorepo/backend/internal/cryptoenvelope"
)

func main() {
	inPath := flag.String("in", "", "input file (envelope)")
	outPath := flag.String("out", "", "output file (plaintext)")
	keyHex := flag.String("keyhex", "", "key hex string (16/24/32 bytes)")
	flag.Parse()

	if *inPath == "" || *outPath == "" || *keyHex == "" {
		fmt.Fprintf(os.Stderr, "usage: bank-decryptor -in <in> -out <out> -keyhex <hex>\n")
		os.Exit(2)
	}
	data, err := os.ReadFile(*inPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to read input: %v\n", err)
		os.Exit(1)
	}
	key, err := hex.DecodeString(*keyHex)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid key hex: %v\n", err)
		os.Exit(1)
	}
	plain, err := cryptoenvelope.Decrypt(data, key)
	if err != nil {
		fmt.Fprintf(os.Stderr, "decrypt failed: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outPath, plain, 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "write out failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("ok")
}


