/*
 * hardware/key_derive_test.c
 *
 * Host-side C test for cm_derive_keys() — T0.4 per-abstraction key derivation.
 * Compiles with host GCC (no FPGA hardware needed).
 *
 * Usage:
 *   gcc -O2 -Wall -o key_derive_test key_derive_test.c && ./key_derive_test
 *
 * Or via Makefile:
 *   make test-key-derive   (in hardware/soc_combined/)
 *
 * Exit code: 0 = all vectors pass, 1 = any vector fails.
 */

#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "sha256.h"
#include "key_derive_vectors.h"

static int bytes_equal(const uint8_t *a, const uint8_t *b, int n)
{
    int i;
    for (i = 0; i < n; i++) {
        if (a[i] != b[i]) return 0;
    }
    return 1;
}

static void print_hex(const char *label, const uint8_t *buf, int n)
{
    int i;
    printf("  %s: ", label);
    for (i = 0; i < n; i++) printf("%02x", buf[i]);
    printf("\n");
}

int main(void)
{
    int i, pass = 0, fail = 0;
    uint8_t k_enc[16], k_mac[16];

    printf("cm_derive_keys() test vectors — T0.4\n");
    printf("Formula: IKM=SHA256(uid||ogt), "
           "K_enc=HKDF(CM_ENC_v3), K_mac=HKDF(CM_MAC_v3)\n\n");

    for (i = 0; i < KEY_DERIVE_VECTOR_COUNT; i++) {
        const key_derive_vector_t *v = &KEY_DERIVE_VECTORS[i];

        memset(k_enc, 0, 16);
        memset(k_mac, 0, 16);

        cm_derive_keys(v->uid_hi, v->uid_lo, v->ogt, k_enc, k_mac);

        int enc_ok = bytes_equal(k_enc, v->k_enc, 16);
        int mac_ok = bytes_equal(k_mac, v->k_mac, 16);

        if (enc_ok && mac_ok) {
            printf("[PASS] %d: %s\n", i, v->ogt);
            pass++;
        } else {
            printf("[FAIL] %d: %s\n", i, v->ogt);
            printf("  uid: %08x%08x\n", v->uid_hi, v->uid_lo);
            if (!enc_ok) {
                print_hex("K_enc expected", v->k_enc, 16);
                print_hex("K_enc got     ", k_enc,    16);
            }
            if (!mac_ok) {
                print_hex("K_mac expected", v->k_mac, 16);
                print_hex("K_mac got     ", k_mac,    16);
            }
            fail++;
        }
    }

    printf("\n%d/%d vectors passed.\n", pass, KEY_DERIVE_VECTOR_COUNT);

    if (fail > 0) {
        printf("FAIL — %d vector(s) did not match.\n", fail);
        return 1;
    }
    printf("PASS — all vectors match Python reference.\n");
    return 0;
}
