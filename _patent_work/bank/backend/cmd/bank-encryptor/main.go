package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"os"

	"github.com/example/monorepo/backend/internal/cryptoenvelope"
)

func main() {
	inPath := flag.String("in", "", "input file")
	outPath := flag.String("out", "", "output file")
	keyHex := flag.String("keyhex", "", "key hex string (16/24/32 bytes)")
	flag.Parse()

	if *inPath == "" || *outPath == "" || *keyHex == "" {
		fmt.Fprintf(os.Stderr, "usage: bank-encryptor -in <in> -out <out> -keyhex <hex>\n")
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
	env, err := cryptoenvelope.Encrypt(data, key)
	if err != nil {
		fmt.Fprintf(os.Stderr, "encrypt failed: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outPath, env, 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "write out failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("ok")
}


