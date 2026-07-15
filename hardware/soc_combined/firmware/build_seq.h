/*
 * hardware/soc_combined/firmware/build_seq.h
 *
 * Auto-managed by scripts/bump_build_letter.sh (called at the start of every
 * build_ti60_bitstream.sh run).  FW_BUILD_LETTER cycles Z→A→B→…→Z→A so the
 * first character emitted on ttyUSB2 immediately confirms which firmware is
 * running without checking version strings or timestamps.
 *
 * Current letter is 'E' — set for banner debug build.
 */
#ifndef BUILD_SEQ_H
#define BUILD_SEQ_H
#define FW_BUILD_LETTER 'E'
#endif
