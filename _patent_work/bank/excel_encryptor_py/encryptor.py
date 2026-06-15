#!/usr/bin/env python3
import argparse
import os
import sys
import secrets
from binascii import unhexlify

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"BC01"
NONCE_LEN = 12

def decode_keyhex(keyhex: str) -> bytes:
    keyhex = keyhex.strip().lower()
    if keyhex.startswith("0x"):
        keyhex = keyhex[2:]
    try:
        key = unhexlify(keyhex)
    except Exception as e:
        raise SystemExit(f"invalid keyhex: {e}")
    if len(key) not in (16, 24, 32):
        raise SystemExit(f"invalid key length: {len(key)} (need 16/24/32 bytes)")
    return key

def encrypt_file(in_path: str, out_path: str, key: bytes):
    with open(in_path, "rb") as f:
        plaintext = f.read()
    nonce = secrets.token_bytes(NONCE_LEN)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, plaintext, None)
    out = MAGIC + bytes([NONCE_LEN]) + nonce + ct
    with open(out_path, "wb") as f:
        f.write(out)

def decrypt_file(in_path: str, out_path: str, key: bytes):
    with open(in_path, "rb") as f:
        data = f.read()
    if len(data) < 4 + 1 + NONCE_LEN:
        raise SystemExit("ciphertext too short")
    if data[:4] != MAGIC:
        raise SystemExit("bad MAGIC (expected BC01)")
    nlen = data[4]
    if nlen != NONCE_LEN:
        raise SystemExit(f"bad nonceLen={nlen} (expected {NONCE_LEN})")
    nonce = data[5:5+NONCE_LEN]
    ct = data[5+NONCE_LEN:]
    aesgcm = AESGCM(key)
    pt = aesgcm.decrypt(nonce, ct, None)
    with open(out_path, "wb") as f:
        f.write(pt)

def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    pe = sub.add_parser("encrypt", help="encrypt file")
    pe.add_argument("--in", dest="in_path", required=True)
    pe.add_argument("--out", dest="out_path", required=True)
    pe.add_argument("--keyhex", required=True)

    pd = sub.add_parser("decrypt", help="decrypt file (for local test)")
    pd.add_argument("--in", dest="in_path", required=True)
    pd.add_argument("--out", dest="out_path", required=True)
    pd.add_argument("--keyhex", required=True)

    args = p.parse_args()
    key = decode_keyhex(args.keyhex)

    if args.cmd == "encrypt":
        encrypt_file(args.in_path, args.out_path, key)
    elif args.cmd == "decrypt":
        decrypt_file(args.in_path, args.out_path, key)
    else:
        raise SystemExit("unknown cmd")

if __name__ == "__main__":
    main()
