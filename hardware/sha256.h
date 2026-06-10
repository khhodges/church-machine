/*
 * hardware/sha256.h
 *
 * Self-contained SHA-256 + HMAC-SHA256 + HKDF-SHA256 + sha32().
 * Header-only.  No malloc.  No libc — requires only <stdint.h> and <stddef.h>
 * (both freestanding headers, available with gcc -ffreestanding -nostdlib).
 *
 * Public API
 * ----------
 *  void     sha256(const uint8_t *data, size_t len, uint8_t digest[32])
 *  uint32_t sha32(const char *ogt)
 *  void     hmac_sha256(const uint8_t *key,  size_t klen,
 *                       const uint8_t *msg,  size_t mlen,
 *                       uint8_t mac[32])
 *  void     hkdf_sha256(const uint8_t *ikm,  size_t ikm_len,
 *                       const uint8_t *salt, size_t salt_len,
 *                       const uint8_t *info, size_t info_len,
 *                       uint8_t *out,        size_t out_len)
 *
 * sha32(ogt):
 *   Returns the first 4 bytes of SHA-256(ogt) as a big-endian uint32_t.
 *   This is the token_32 identity primitive used in ns_manifest and the
 *   CM_MSG key-derivation formula.
 *
 * hkdf_sha256():
 *   info is capped at 128 bytes (sufficient for any OGT string).
 *   out_len must be ≤ 255 * 32 = 8160 bytes (HKDF limit).
 *
 * Reference: FIPS 180-4, RFC 2104, RFC 5869.
 * Verified against:
 *   - RFC 5869 Appendix A.1 test vector (HKDF)
 *   - Independent Python hashlib computation (sha32 for all 9 Core OGTs)
 *
 * Copyright: public-domain implementation (based on Brad Conte's SHA-256
 * reference, placed in the public domain).
 */

#ifndef HARDWARE_SHA256_H
#define HARDWARE_SHA256_H

#include <stdint.h>
#include <stddef.h>

/* -------------------------------------------------------------------------
 * Internal helper: strlen without libc
 * ---------------------------------------------------------------------- */
static size_t _sha256_strlen(const char *s)
{
    size_t n = 0;
    while (s[n]) n++;
    return n;
}

/* -------------------------------------------------------------------------
 * Internal helper: memcpy / memset without libc
 * (gcc treats these as builtins under -ffreestanding, but provide them
 *  explicitly in case the compiler doesn't emit calls)
 * ---------------------------------------------------------------------- */
static void _sha256_memcpy(void *dst, const void *src, size_t n)
{
    const uint8_t *s = (const uint8_t *)src;
    uint8_t       *d = (uint8_t *)dst;
    while (n--) *d++ = *s++;
}

static void _sha256_memset(void *dst, int c, size_t n)
{
    uint8_t *d = (uint8_t *)dst;
    while (n--) *d++ = (uint8_t)c;
}

/* -------------------------------------------------------------------------
 * SHA-256 core
 * ---------------------------------------------------------------------- */

#define _SHA256_ROTR(a,b) (((a) >> (b)) | ((a) << (32u - (b))))
#define _SHA256_CH(x,y,z)  (((x) & (y)) ^ (~(x) & (z)))
#define _SHA256_MAJ(x,y,z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define _SHA256_EP0(x)     (_SHA256_ROTR(x,2)  ^ _SHA256_ROTR(x,13) ^ _SHA256_ROTR(x,22))
#define _SHA256_EP1(x)     (_SHA256_ROTR(x,6)  ^ _SHA256_ROTR(x,11) ^ _SHA256_ROTR(x,25))
#define _SHA256_SIG0(x)    (_SHA256_ROTR(x,7)  ^ _SHA256_ROTR(x,18) ^ ((x) >> 3))
#define _SHA256_SIG1(x)    (_SHA256_ROTR(x,17) ^ _SHA256_ROTR(x,19) ^ ((x) >> 10))

static const uint32_t _sha256_K[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

typedef struct {
    uint8_t  buf[64];
    uint32_t state[8];
    uint32_t datalen;
    uint64_t bitlen;
} _sha256_ctx_t;

static void _sha256_transform(_sha256_ctx_t *ctx, const uint8_t data[64])
{
    uint32_t a, b, c, d, e, f, g, h, i, j, t1, t2, m[64];

    for (i = 0, j = 0; i < 16u; ++i, j += 4u)
        m[i] = ((uint32_t)data[j]   << 24) | ((uint32_t)data[j+1] << 16)
             | ((uint32_t)data[j+2] <<  8) |  (uint32_t)data[j+3];
    for (; i < 64u; ++i)
        m[i] = _SHA256_SIG1(m[i-2]) + m[i-7] + _SHA256_SIG0(m[i-15]) + m[i-16];

    a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
    e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];

    for (i = 0; i < 64u; ++i) {
        t1 = h + _SHA256_EP1(e) + _SHA256_CH(e,f,g) + _sha256_K[i] + m[i];
        t2 = _SHA256_EP0(a) + _SHA256_MAJ(a,b,c);
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }

    ctx->state[0] += a; ctx->state[1] += b;
    ctx->state[2] += c; ctx->state[3] += d;
    ctx->state[4] += e; ctx->state[5] += f;
    ctx->state[6] += g; ctx->state[7] += h;
}

static void _sha256_init(_sha256_ctx_t *ctx)
{
    ctx->datalen = 0;
    ctx->bitlen  = 0;
    ctx->state[0] = 0x6a09e667u;
    ctx->state[1] = 0xbb67ae85u;
    ctx->state[2] = 0x3c6ef372u;
    ctx->state[3] = 0xa54ff53au;
    ctx->state[4] = 0x510e527fu;
    ctx->state[5] = 0x9b05688cu;
    ctx->state[6] = 0x1f83d9abu;
    ctx->state[7] = 0x5be0cd19u;
}

static void _sha256_update(_sha256_ctx_t *ctx, const uint8_t *data, size_t len)
{
    size_t i;
    for (i = 0; i < len; ++i) {
        ctx->buf[ctx->datalen++] = data[i];
        if (ctx->datalen == 64u) {
            _sha256_transform(ctx, ctx->buf);
            ctx->bitlen  += 512u;
            ctx->datalen  = 0;
        }
    }
}

static void _sha256_final(_sha256_ctx_t *ctx, uint8_t digest[32])
{
    uint32_t i = ctx->datalen;

    /* Padding */
    if (ctx->datalen < 56u) {
        ctx->buf[i++] = 0x80u;
        while (i < 56u) ctx->buf[i++] = 0x00u;
    } else {
        ctx->buf[i++] = 0x80u;
        while (i < 64u) ctx->buf[i++] = 0x00u;
        _sha256_transform(ctx, ctx->buf);
        _sha256_memset(ctx->buf, 0, 56);
    }

    /* Append bit length (big-endian 64-bit) */
    ctx->bitlen += (uint64_t)ctx->datalen * 8u;
    ctx->buf[63] = (uint8_t)(ctx->bitlen);
    ctx->buf[62] = (uint8_t)(ctx->bitlen >>  8);
    ctx->buf[61] = (uint8_t)(ctx->bitlen >> 16);
    ctx->buf[60] = (uint8_t)(ctx->bitlen >> 24);
    ctx->buf[59] = (uint8_t)(ctx->bitlen >> 32);
    ctx->buf[58] = (uint8_t)(ctx->bitlen >> 40);
    ctx->buf[57] = (uint8_t)(ctx->bitlen >> 48);
    ctx->buf[56] = (uint8_t)(ctx->bitlen >> 56);
    _sha256_transform(ctx, ctx->buf);

    /* Output (big-endian) */
    for (i = 0; i < 4u; ++i) {
        digest[i]      = (ctx->state[0] >> (24u - i * 8u)) & 0xffu;
        digest[i + 4]  = (ctx->state[1] >> (24u - i * 8u)) & 0xffu;
        digest[i + 8]  = (ctx->state[2] >> (24u - i * 8u)) & 0xffu;
        digest[i + 12] = (ctx->state[3] >> (24u - i * 8u)) & 0xffu;
        digest[i + 16] = (ctx->state[4] >> (24u - i * 8u)) & 0xffu;
        digest[i + 20] = (ctx->state[5] >> (24u - i * 8u)) & 0xffu;
        digest[i + 24] = (ctx->state[6] >> (24u - i * 8u)) & 0xffu;
        digest[i + 28] = (ctx->state[7] >> (24u - i * 8u)) & 0xffu;
    }
}

/* -------------------------------------------------------------------------
 * Public: sha256()
 * ---------------------------------------------------------------------- */
/* Suppress unused-function warnings: sha256.h is a header-only library;
 * any particular compilation unit may call only a subset of the API. */
#if defined(__GNUC__) || defined(__clang__)
#  define _SHA256_UNUSED __attribute__((__unused__))
#else
#  define _SHA256_UNUSED
#endif

static _SHA256_UNUSED void sha256(const uint8_t *data, size_t len, uint8_t digest[32])
{
    _sha256_ctx_t ctx;
    _sha256_init(&ctx);
    _sha256_update(&ctx, data, len);
    _sha256_final(&ctx, digest);
}

/* -------------------------------------------------------------------------
 * Public: sha32()
 *
 * Returns the first 4 bytes of SHA-256(ogt) as a big-endian uint32_t.
 * This is the token_32 identity primitive: unique per OGT, stable across
 * firmware/bridge/IDE, used in ns_manifest and key derivation.
 * ---------------------------------------------------------------------- */
static _SHA256_UNUSED uint32_t sha32(const char *ogt)
{
    uint8_t digest[32];
    sha256((const uint8_t *)ogt, _sha256_strlen(ogt), digest);
    return ((uint32_t)digest[0] << 24) | ((uint32_t)digest[1] << 16)
         | ((uint32_t)digest[2] <<  8) |  (uint32_t)digest[3];
}

/* -------------------------------------------------------------------------
 * Public: hmac_sha256()
 * ---------------------------------------------------------------------- */
static _SHA256_UNUSED void hmac_sha256(const uint8_t *key,  size_t klen,
                        const uint8_t *msg,  size_t mlen,
                        uint8_t        mac[32])
{
    uint8_t       k_buf[64];
    uint8_t       i_key_pad[64], o_key_pad[64];
    uint8_t       inner[32];
    _sha256_ctx_t ctx;
    size_t        i;

    /* If key longer than block size, hash it */
    if (klen > 64u) {
        sha256(key, klen, k_buf);
        klen = 32u;
    } else {
        _sha256_memcpy(k_buf, key, klen);
    }
    _sha256_memset(k_buf + klen, 0, 64u - klen);

    for (i = 0; i < 64u; ++i) {
        i_key_pad[i] = k_buf[i] ^ 0x36u;
        o_key_pad[i] = k_buf[i] ^ 0x5cu;
    }

    /* Inner: SHA256(ipad || msg) */
    _sha256_init(&ctx);
    _sha256_update(&ctx, i_key_pad, 64u);
    _sha256_update(&ctx, msg, mlen);
    _sha256_final(&ctx, inner);

    /* Outer: SHA256(opad || inner) */
    _sha256_init(&ctx);
    _sha256_update(&ctx, o_key_pad, 64u);
    _sha256_update(&ctx, inner, 32u);
    _sha256_final(&ctx, mac);
}

/* -------------------------------------------------------------------------
 * Public: hkdf_sha256()
 *
 * RFC 5869 HKDF using HMAC-SHA256.
 * info is capped at 128 bytes (sufficient for any OGT string ≤ 128 bytes).
 * out_len must be ≤ 255 * 32 bytes.
 * ---------------------------------------------------------------------- */
static _SHA256_UNUSED void hkdf_sha256(const uint8_t *ikm,  size_t ikm_len,
                        const uint8_t *salt, size_t salt_len,
                        const uint8_t *info, size_t info_len,
                        uint8_t       *out,  size_t out_len)
{
    uint8_t prk[32];
    uint8_t t[32];
    /* T(n-1) || info || ctr — max 32 + 128 + 1 = 161 bytes */
    uint8_t buf[161];
    size_t  pos = 0, buf_len, copy_len;
    uint8_t ctr = 1u;

    /* Cap info to 128 bytes */
    if (info_len > 128u) info_len = 128u;

    /* HKDF-Extract */
    hmac_sha256(salt, salt_len, ikm, ikm_len, prk);

    /* HKDF-Expand */
    while (pos < out_len) {
        buf_len = 0;
        if (ctr > 1u) {
            _sha256_memcpy(buf, t, 32u);
            buf_len = 32u;
        }
        if (info_len > 0u) {
            _sha256_memcpy(buf + buf_len, info, info_len);
            buf_len += info_len;
        }
        buf[buf_len++] = ctr++;
        hmac_sha256(prk, 32u, buf, buf_len, t);
        copy_len = out_len - pos;
        if (copy_len > 32u) copy_len = 32u;
        _sha256_memcpy(out + pos, t, copy_len);
        pos += copy_len;
    }
}

/* -------------------------------------------------------------------------
 * Public: cm_derive_keys()
 *
 * Per-abstraction key derivation (T0.4 — CM_MSG Protocol Section 2.6).
 *
 * Formula (spec-authoritative, CM_ENC_v3 / CM_MAC_v3):
 *   preimage  = uid_hi_bytes(4,BE) || uid_lo_bytes(4,BE) || ogt_utf8
 *   IKM       = SHA256(preimage)
 *   K_enc[16] = HKDF-SHA256(IKM, salt="CM_ENC_v3", info=ogt, len=16)
 *   K_mac[16] = HKDF-SHA256(IKM, salt="CM_MAC_v3", info=ogt, len=16)
 *
 * Keys must live in RISC-V private RAM (not shared CM-core BRAM).
 * The IKM working buffer is zeroed immediately after use.
 *
 * Canonical test vectors: hardware/key_derive_vectors.h
 *   (generated by scripts/test_key_derivation_vectors.py)
 * ---------------------------------------------------------------------- */
static _SHA256_UNUSED void cm_derive_keys(
        uint32_t uid_hi, uint32_t uid_lo,
        const char *ogt,
        uint8_t k_enc_out[16], uint8_t k_mac_out[16])
{
    /* preimage = uid_hi(4 BE) || uid_lo(4 BE) || ogt(UTF-8, ≤ 248 bytes) */
    uint8_t preimage[8u + 248u];
    uint8_t ikm[32];
    size_t  ogt_len;
    size_t  preimage_len;

    /* Clamp OGT length FIRST, then compute preimage_len from the clamped value.
     * Computing preimage_len before the clamp would allow sha256() and the
     * wipe memset to read/write past preimage[] on pathological OGT strings. */
    ogt_len = _sha256_strlen(ogt);
    if (ogt_len > 248u) ogt_len = 248u;
    preimage_len = 8u + ogt_len;

    /* uid_hi — 4 bytes big-endian */
    preimage[0] = (uint8_t)(uid_hi >> 24u);
    preimage[1] = (uint8_t)(uid_hi >> 16u);
    preimage[2] = (uint8_t)(uid_hi >>  8u);
    preimage[3] = (uint8_t)(uid_hi);
    /* uid_lo — 4 bytes big-endian */
    preimage[4] = (uint8_t)(uid_lo >> 24u);
    preimage[5] = (uint8_t)(uid_lo >> 16u);
    preimage[6] = (uint8_t)(uid_lo >>  8u);
    preimage[7] = (uint8_t)(uid_lo);
    /* OGT bytes */
    _sha256_memcpy(preimage + 8u, ogt, ogt_len);

    /* IKM = SHA256(uid || ogt) */
    sha256(preimage, preimage_len, ikm);

    /* K_enc = HKDF-SHA256(IKM, salt="CM_ENC_v3", info=ogt, len=16) */
    hkdf_sha256(ikm,   32u,
                (const uint8_t *)"CM_ENC_v3", 9u,
                (const uint8_t *)ogt, ogt_len,
                k_enc_out, 16u);

    /* K_mac = HKDF-SHA256(IKM, salt="CM_MAC_v3", info=ogt, len=16) */
    hkdf_sha256(ikm,   32u,
                (const uint8_t *)"CM_MAC_v3", 9u,
                (const uint8_t *)ogt, ogt_len,
                k_mac_out, 16u);

    /* Wipe working state immediately — keys must never linger in stack */
    _sha256_memset(preimage, 0, preimage_len);
    _sha256_memset(ikm,      0, 32u);
}

#endif /* HARDWARE_SHA256_H */
