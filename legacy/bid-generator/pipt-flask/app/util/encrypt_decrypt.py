# -- coding: utf-8 --
# @Time : 2025/2/17 11:00
# @Author : Yao Sicheng
from gmssl import sm4
key = "1c32ffaed32b869d0314bbfa8896b13a2dcea85225f2fb71"
# 加密密码
def encrypt_password(password):
    if password is None:
        return None
    cipher = sm4.CryptSM4()
    cipher.set_key(bytes.fromhex(key), sm4.SM4_ENCRYPT)
    ciphertext = cipher.crypt_ecb(password.encode("utf-8"))
    return ciphertext.hex()


# 解密密码
def decrypt_password(encrypted_password):
    if encrypted_password is None:
        return None
    cipher = sm4.CryptSM4()
    cipher.set_key(bytes.fromhex(key), sm4.SM4_DECRYPT)
    plaintext = cipher.crypt_ecb(bytes.fromhex(encrypted_password))
    return plaintext.decode("utf-8")
