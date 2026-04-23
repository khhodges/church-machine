attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/uart_test.py:40"
attribute \top 1
module \top

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:116"
  memory width 32 size 256 \init_mem_rd

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:94"
  wire width 1 \tx

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:19"
  wire width 1 \rx

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:84"
  wire width 9 \addr

  attribute \src "/home/runner/workspace/church_machine/core.py:37"
  wire width 32 \imem_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:38"
  wire width 32 \imem_data

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:85"
  wire width 32 \data

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:68"
  wire width 1 \any_ns_access

  attribute \src "/home/runner/workspace/church_machine/core.py:48"
  wire width 1 \ns_rd_en

  attribute \src "/home/runner/workspace/church_machine/core.py:51"
  wire width 1 \ns_wr_en

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:69"
  wire width 1 \any_clist_access

  attribute \src "/home/runner/workspace/church_machine/core.py:54"
  wire width 1 \clist_rd_en

  attribute \src "/home/runner/workspace/church_machine/core.py:57"
  wire width 1 \clist_wr_en

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:67"
  wire width 14 \mem_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:47"
  wire width 32 \ns_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:53"
  wire width 32 \clist_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:41"
  wire width 32 \dmem_addr

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:81"
  wire width 32 \wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:50"
  wire width 96 \ns_wr_data

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:82"
  wire width 1 \wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 32 \clist_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:44"
  wire width 32 \dmem_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:45"
  wire width 1 \dmem_wr_en

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:90"
  attribute \init 1'0
  wire width 1 \load_done

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:20"
  wire width 14 \addr$31

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:21"
  wire width 32 \wr_data$32

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:23"
  wire width 1 \wr_en$33

  attribute \src "/home/runner/workspace/church_machine/core.py:43"
  wire width 32 \dmem_rd_data

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:22"
  wire width 32 \rd_data

  attribute \src "/home/runner/workspace/church_machine/core.py:49"
  wire width 96 \ns_rd_data

  attribute \src "/home/runner/workspace/church_machine/core.py:55"
  wire width 32 \clist_rd_data

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:117"
  wire width 8 \init_mem_r_addr

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:113"
  attribute \init 9'000000000
  wire width 9 \default_idx

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:114"
  wire width 32 \default_word

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:117"
  wire width 32 \init_mem_r_data

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \loader_fsm_state

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:117"
  wire width 1 \init_mem_r_en

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:125"
  attribute \init 9'000000000
  wire width 9 \load_words_received

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:122"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \load_word

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:220"
  attribute \init 1'0
  wire width 1 \boot_triggered

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:219"
  attribute \init 4'0000
  wire width 4 \boot_delay

  attribute \src "/home/runner/workspace/church_machine/core.py:59"
  wire width 1 \boot_start

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:233"
  wire width 1 \nia_changed

  attribute \src "/home/runner/workspace/church_machine/core.py:70"
  wire width 32 \nia

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:231"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \prev_nia

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:235"
  wire width 1 \step_complete

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:229"
  attribute \init 1'0
  wire width 1 \stepping

  attribute \src "/home/runner/workspace/church_machine/core.py:39"
  wire width 1 \imem_valid

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:228"
  attribute \init 1'1
  wire width 1 \halted

  attribute \src "/home/runner/workspace/church_machine/core.py:63"
  wire width 1 \gc_start

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:249"
  wire width 1 \btn_press

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:242"
  attribute \init 1'0
  wire width 1 \btn_prev

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:241"
  attribute \init 3'000
  wire width 3 \btn_sync

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:254"
  wire width 1 \heartbeat_blink

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:252"
  attribute \init 23'00000000000000000000000
  wire width 23 \heartbeat_ctr

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:257"
  wire width 1 \led_loading

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:258"
  wire width 1 \led_boot

  attribute \src "/home/runner/workspace/church_machine/core.py:61"
  wire width 1 \boot_complete

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:259"
  wire width 1 \led_run

  attribute \src "/home/runner/workspace/church_machine/core.py:68"
  wire width 1 \fault_valid

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:260"
  wire width 1 \led_fault

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:261"
  wire width 1 \led_halted_blink

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:272"
  wire width 8 \banner_byte

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:271"
  attribute \init 4'0000
  wire width 4 \banner_idx

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:277"
  wire width 8 \halt_byte

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:276"
  attribute \init 3'000
  wire width 3 \halt_idx

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:282"
  wire width 8 \step_byte

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:281"
  attribute \init 2'00
  wire width 2 \step_idx

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:287"
  wire width 8 \fault_byte

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:286"
  attribute \init 2'00
  wire width 2 \fault_msg_idx

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \debug_fsm_state

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:93"
  wire width 1 \busy

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:92"
  wire width 8 \byte_data

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:91"
  wire width 1 \send_byte

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:89"
  wire width 32 \data$81

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:90"
  wire width 1 \send

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:290"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \step_nia

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:394"
  wire width 32 \fault_word

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:291"
  attribute \init 4'0000
  wire width 4 \step_fault

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:72"
  wire width 1 \r

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:73"
  wire width 1 \g

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:74"
  wire width 1 \b

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:127"
  attribute \init 24'000000000000000000000000
  wire width 24 \auto_boot_ctr

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:21"
  wire width 1 \valid

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:123"
  attribute \init 2'00
  wire width 2 \load_byte_idx

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:20"
  wire width 8 \data$92

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:124"
  attribute \init 9'000000000
  wire width 9 \load_word_count

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:295"
  attribute \init 26'00000000000000000000000000
  wire width 26 \startup_ctr

  attribute \src "/home/runner/workspace/church_machine/core.py:67"
  wire width 4 \fault

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:292"
  attribute \init 1'0
  wire width 1 \step_had_fault

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:19"
  wire width 1 input 0  \uart_rx

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:36"
  wire width 1 input 1  \push_button

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 3  \rst

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:94"
  wire width 1 output 4  \uart_tx

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:72"
  wire width 1 output 5  \led_r

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:34"
  wire width 1 output 6  \led_g

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:35"
  wire width 1 output 7  \led_b

  wire width 10 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  wire width 1 $22

  wire width 1 $23

  wire width 1 $24

  wire width 1 $25

  wire width 1 $26

  wire width 1 $27

  wire width 1 $28

  wire width 1 $29

  wire width 1 $30

  wire width 1 $31

  wire width 1 $32

  wire width 1 $33

  wire width 1 $34

  wire width 1 $35

  wire width 1 $36

  wire width 1 $37

  wire width 1 $38

  wire width 1 $39

  wire width 1 $40

  wire width 1 $41

  wire width 1 $42

  wire width 1 $43

  wire width 1 $44

  wire width 1 $45

  wire width 25 $46

  wire width 1 $47

  wire width 1 $48

  wire width 1 $49

  wire width 1 $50

  wire width 1 $51

  wire width 3 $52

  wire width 10 $53

  wire width 1 $54

  wire width 10 $55

  wire width 1 $56

  wire width 1 $57

  wire width 1 $58

  wire width 1 $59

  wire width 1 $60

  wire width 3 $61

  wire width 10 $62

  wire width 10 $63

  wire width 1 $64

  wire width 1 $65

  wire width 1 $66

  wire width 1 $67

  wire width 5 $68

  wire width 24 $69

  wire width 27 $70

  wire width 1 $71

  wire width 1 $72

  wire width 1 $73

  wire width 5 $74

  wire width 1 $75

  wire width 1 $76

  wire width 1 $77

  wire width 4 $78

  wire width 1 $79

  wire width 1 $80

  wire width 3 $81

  wire width 1 $82

  wire width 1 $83

  wire width 1 $84

  wire width 3 $85

  wire width 1 $86

  wire width 24 $87

  wire width 32 $88

  wire width 9 $89

  wire width 2 $90

  wire width 3 $91

  wire width 9 $92

  wire width 1 $93

  wire width 9 $94

  wire width 4 $95

  wire width 1 $96

  wire width 32 $97

  wire width 3 $98

  wire width 1 $99

  wire width 23 $100

  wire width 26 $101

  wire width 4 $102

  wire width 4 $103

  wire width 1 $104

  wire width 3 $105

  wire width 1 $106

  wire width 32 $107

  wire width 4 $108

  wire width 1 $109

  wire width 2 $110

  wire width 2 $111

  wire width 16 $112

  wire width 16 $113

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 2 \clist_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 6 \clist_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 17 \clist_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 7 \clist_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:55"
  wire width 2 \clist_rd_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:55"
  wire width 6 \clist_rd_data.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:55"
  wire width 17 \clist_rd_data.index

  attribute \src "/home/runner/workspace/church_machine/core.py:55"
  wire width 7 \clist_rd_data.version

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:43"
  cell \top.debug \debug
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \byte_data \byte_data [7:0]
    connect \send_byte \send_byte [0]
    connect \data$16 \data$81 [31:0]
    connect \send \send [0]
    connect \busy \busy [0]
    connect \tx \uart_tx [0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:47"
  cell \top.uart_rx$98 \uart_rx$98
    connect \rx \uart_rx [0]
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \data \data$92 [7:0]
    connect \valid \valid [0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:51"
  cell \top.rgb \rgb
    connect \g \g [0]
    connect \b \b [0]
    connect \r \led_r [0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:54"
  cell \top.core \core
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \imem_valid \imem_valid [0]
    connect \boot_complete \boot_complete [0]
    connect \perm_gt_sig \clist_wr_data [31:0]
    connect \port$1202$0 $112 [15:0]
    connect \port$1203$0 $113 [15:0]
    connect \boot_start \boot_start [0]
    connect \fault \fault [3:0]
    connect \fault_valid$225 \led_r [0]
    connect \dmem_addr \dmem_addr [31:0]
    connect \dmem_wr_data \dmem_wr_data [31:0]
    connect \dmem_wr_en \dmem_wr_en [0]
    connect \imem_addr \imem_addr [31:0]
    connect \instruction \imem_data [31:0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:57"
  cell \top.boot_rom \boot_rom
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \addr \imem_addr [10:2]
    connect \data \imem_data [31:0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:60"
  cell \top.spram \spram
    connect \clk \clk [0]
    connect \port$1202$0 $112 [15:0]
    connect \port$1203$0 $113 [15:0]
    connect \addr \addr$31 [13:0]
    connect \wr_data \wr_data$32 [31:0]
    connect \wr_en \wr_en$33 [0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:71"
  cell $or $114
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \any_ns_access
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:72"
  cell $or $115
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \any_clist_access
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:163"
  cell $sub $116
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 10
    connect \A \default_idx [8:0]
    connect \B 1'1
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:167"
  cell $ge $117
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 9
    parameter \Y_WIDTH 1
    connect \A \default_idx [8:0]
    connect \B 9'100000000
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:221"
  cell $not $118
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_triggered [0]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:221"
  cell $and $119
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $3 [0]
    connect \B \load_done [0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:222"
  cell $lt $120
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \boot_delay [3:0]
    connect \B 4'1111
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:234"
  cell $ne $121
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 32
    parameter \Y_WIDTH 1
    connect \A \imem_addr [31:0]
    connect \B \prev_nia [31:0]
    connect \Y \nia_changed
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:236"
  cell $and $122
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \stepping [0]
    connect \B \nia_changed [0]
    connect \Y \step_complete
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:238"
  cell $not $123
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \halted [0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:238"
  cell $not $124
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \step_complete [0]
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:238"
  cell $and $125
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \stepping [0]
    connect \B $7 [0]
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:238"
  cell $or $126
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $6 [0]
    connect \B $8 [0]
    connect \Y \imem_valid
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:250"
  cell $not $127
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \btn_sync [2]
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:250"
  cell $and $128
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \btn_prev [0]
    connect \B $9 [0]
    connect \Y \btn_press
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:263"
  cell $not $129
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \load_done [0]
    connect \Y \led_loading
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:264"
  cell $not $130
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_complete [0]
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:264"
  cell $and $131
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \load_done [0]
    connect \B $10 [0]
    connect \Y \led_boot
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:265"
  cell $not $132
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \led_r [0]
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:265"
  cell $and $133
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_complete [0]
    connect \B $11 [0]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:265"
  cell $not $134
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \halted [0]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:265"
  cell $and $135
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $12 [0]
    connect \B $13 [0]
    connect \Y \led_run
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:267"
  cell $and $136
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_complete [0]
    connect \B \halted [0]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:267"
  cell $not $137
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \led_r [0]
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:267"
  cell $and $138
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $14 [0]
    connect \B $15 [0]
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:267"
  cell $and $139
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $16 [0]
    connect \B \heartbeat_ctr [22]
    connect \Y \led_halted_blink
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:273"
  process $140
    assign \banner_byte [7:0] 8'00000000
    switch \banner_idx [3:0]
      case 4'0000
        assign \banner_byte [7:0] 8'01000011
      case 4'0001
        assign \banner_byte [7:0] 8'01001000
      case 4'0010
        assign \banner_byte [7:0] 8'01010101
      case 4'0011
        assign \banner_byte [7:0] 8'01010010
      case 4'0100
        assign \banner_byte [7:0] 8'01000011
      case 4'0101
        assign \banner_byte [7:0] 8'01001000
      case 4'0110
        assign \banner_byte [7:0] 8'00100000
      case 4'0111
        assign \banner_byte [7:0] 8'01110110
      case 4'1000
        assign \banner_byte [7:0] 8'00110001
      case 4'1001
        assign \banner_byte [7:0] 8'00101110
      case 4'1010
        assign \banner_byte [7:0] 8'00110000
      case 4'1011
        assign \banner_byte [7:0] 8'00001101
      case 4'1100
        assign \banner_byte [7:0] 8'00001010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:278"
  process $141
    assign \halt_byte [7:0] 8'00000000
    switch \halt_idx [2:0]
      case 3'000
        assign \halt_byte [7:0] 8'01001000
      case 3'001
        assign \halt_byte [7:0] 8'01000001
      case 3'010
        assign \halt_byte [7:0] 8'01001100
      case 3'011
        assign \halt_byte [7:0] 8'01010100
      case 3'100
        assign \halt_byte [7:0] 8'00001101
      case 3'101
        assign \halt_byte [7:0] 8'00001010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:283"
  process $142
    assign \step_byte [7:0] 8'00000000
    switch \step_idx [1:0]
      case 2'00
        assign \step_byte [7:0] 8'01010011
      case 2'01
        assign \step_byte [7:0] 8'00111010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:288"
  process $143
    assign \fault_byte [7:0] 8'00000000
    switch \fault_msg_idx [1:0]
      case 2'00
        assign \fault_byte [7:0] 8'01000110
      case 2'01
        assign \fault_byte [7:0] 8'00111010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:309"
  cell $not $144
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:310"
  cell $lt $145
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \banner_idx [3:0]
    connect \B 4'1101
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:320"
  cell $not $146
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:328"
  cell $not $147
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:329"
  cell $lt $148
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \halt_idx [2:0]
    connect \B 3'110
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:356"
  cell $not $149
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:357"
  cell $lt $150
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \step_idx [1:0]
    connect \B 2'10
    connect \Y $23
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:368"
  cell $not $151
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $24
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:381"
  cell $not $152
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $25
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:382"
  cell $lt $153
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \fault_msg_idx [1:0]
    connect \B 2'10
    connect \Y $26
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:393"
  cell $not $154
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $27
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:405"
  cell $or $155
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \led_run [0]
    connect \B \led_halted_blink [0]
    connect \Y \g
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:406"
  cell $or $156
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \led_loading [0]
    connect \B \led_boot [0]
    connect \Y \b
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:410"
  cell $or $157
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \led_run [0]
    connect \B \led_halted_blink [0]
    connect \Y \led_g
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:411"
  cell $or $158
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \led_loading [0]
    connect \B \led_boot [0]
    connect \Y \led_b
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $159
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \loader_fsm_state [2:0]
    connect \B {  }
    connect \Y $28
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $160
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \loader_fsm_state [2:0]
    connect \B 1'1
    connect \Y $29
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $161
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \loader_fsm_state [2:0]
    connect \B 2'10
    connect \Y $30
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $162
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \loader_fsm_state [2:0]
    connect \B 2'11
    connect \Y $31
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $163
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \loader_fsm_state [2:0]
    connect \B 3'100
    connect \Y $32
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $164
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \loader_fsm_state [2:0]
    connect \B 3'101
    connect \Y $33
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $165
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \loader_fsm_state [2:0]
    connect \B 3'110
    connect \Y $34
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $166
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B {  }
    connect \Y $35
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $167
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 1'1
    connect \Y $36
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $168
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 2'10
    connect \Y $37
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $169
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 2'11
    connect \Y $38
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $170
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 3'100
    connect \Y $39
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $171
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 3'101
    connect \Y $40
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $172
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 3'110
    connect \Y $41
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $173
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 3'111
    connect \Y $42
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $174
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 4'1000
    connect \Y $43
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $175
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 4'1001
    connect \Y $44
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $176
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \debug_fsm_state [3:0]
    connect \B 4'1010
    connect \Y $45
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:132"
  cell $add $177
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 24
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 25
    connect \A \auto_boot_ctr [23:0]
    connect \B 1'1
    connect \Y $46
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:153"
  cell $ge $178
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 24
    parameter \B_WIDTH 24
    parameter \Y_WIDTH 1
    connect \A \auto_boot_ctr [23:0]
    connect \B 24'101101110001101100000000
    connect \Y $47
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:134"
  cell $eq $179
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B {  }
    connect \Y $48
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:136"
  cell $eq $180
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B 1'1
    connect \Y $49
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:138"
  cell $eq $181
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B 2'10
    connect \Y $50
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:143"
  cell $eq $182
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B 2'11
    connect \Y $51
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:151"
  cell $add $183
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 3
    connect \A \load_byte_idx [1:0]
    connect \B 1'1
    connect \Y $52
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:158"
  cell $add $184
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 10
    connect \A \default_idx [8:0]
    connect \B 1'1
    connect \Y $53
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:167"
  cell $ge $185
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 9
    parameter \Y_WIDTH 1
    connect \A \default_idx [8:0]
    connect \B 9'100000000
    connect \Y $54
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:172"
  cell $add $186
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 10
    connect \A \default_idx [8:0]
    connect \B 1'1
    connect \Y $55
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:176"
  cell $le $187
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 9
    parameter \Y_WIDTH 1
    connect \A \load_word [8:0]
    connect \B 9'100000000
    connect \Y $56
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:185"
  cell $eq $188
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B {  }
    connect \Y $57
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:187"
  cell $eq $189
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B 1'1
    connect \Y $58
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:189"
  cell $eq $190
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B 2'10
    connect \Y $59
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:194"
  cell $eq $191
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_byte_idx [1:0]
    connect \B 2'11
    connect \Y $60
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:197"
  cell $add $192
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 3
    connect \A \load_byte_idx [1:0]
    connect \B 1'1
    connect \Y $61
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:206"
  cell $add $193
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 10
    connect \A \load_words_received [8:0]
    connect \B 1'1
    connect \Y $62
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:210"
  cell $add $194
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 9
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 10
    connect \A \load_words_received [8:0]
    connect \B 1'1
    connect \Y $63
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:210"
  cell $ge $195
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 10
    parameter \B_WIDTH 9
    parameter \Y_WIDTH 1
    connect \A $63 [9:0]
    connect \B \load_word_count [8:0]
    connect \Y $64
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:221"
  cell $not $196
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_triggered [0]
    connect \Y $65
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:221"
  cell $and $197
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $65 [0]
    connect \B \load_done [0]
    connect \Y $66
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:222"
  cell $lt $198
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \boot_delay [3:0]
    connect \B 4'1111
    connect \Y $67
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:223"
  cell $add $199
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 5
    connect \A \boot_delay [3:0]
    connect \B 1'1
    connect \Y $68
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:253"
  cell $add $200
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 23
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 24
    connect \A \heartbeat_ctr [22:0]
    connect \B 1'1
    connect \Y $69
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:299"
  cell $add $201
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 26
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 27
    connect \A \startup_ctr [25:0]
    connect \B 1'1
    connect \Y $70
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:300"
  cell $eq $202
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 26
    parameter \B_WIDTH 26
    parameter \Y_WIDTH 1
    connect \A \startup_ctr [25:0]
    connect \B 26'10001001010101000011111111
    connect \Y $71
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:309"
  cell $not $203
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $72
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:310"
  cell $lt $204
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \banner_idx [3:0]
    connect \B 4'1101
    connect \Y $73
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:315"
  cell $add $205
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 5
    connect \A \banner_idx [3:0]
    connect \B 1'1
    connect \Y $74
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:320"
  cell $not $206
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $75
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:328"
  cell $not $207
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $76
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:329"
  cell $lt $208
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \halt_idx [2:0]
    connect \B 3'110
    connect \Y $77
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:334"
  cell $add $209
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 4
    connect \A \halt_idx [2:0]
    connect \B 1'1
    connect \Y $78
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:356"
  cell $not $210
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $79
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:357"
  cell $lt $211
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \step_idx [1:0]
    connect \B 2'10
    connect \Y $80
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:362"
  cell $add $212
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 3
    connect \A \step_idx [1:0]
    connect \B 1'1
    connect \Y $81
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:368"
  cell $not $213
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $82
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:381"
  cell $not $214
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $83
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:382"
  cell $lt $215
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \fault_msg_idx [1:0]
    connect \B 2'10
    connect \Y $84
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:387"
  cell $add $216
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 3
    connect \A \fault_msg_idx [1:0]
    connect \B 1'1
    connect \Y $85
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:393"
  cell $not $217
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy [0]
    connect \Y $86
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:116"
  cell $meminit_v2 $218
    parameter \MEMID "\\init_mem_rd"
    parameter \ABITS 0
    parameter \WIDTH 32
    parameter \WORDS 256
    parameter \PRIORITY 0
    connect \ADDR {  }
    connect \DATA 8192'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000010010000000000000000000000000000110001000000000000000000000000001011000000000000000000000000000001010000000000000000000000000000000000000100000000000000000000001000001000000000000000000000000001100010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000111100000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000111000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000110100000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000110000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000101100000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000101000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000100100000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000100000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000011100000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000011000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000010100000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000010000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000001100000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000001000000000000000000000000000000000000000001000000000000000000000000000100000000000000000000000000100000000000000000000000000000000000000001000000000000000000000000000100000000000000000001111110100000000
    connect \EN 32'11111111111111111111111111111111
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:117"
  cell $memrd_v2 $219
    parameter \MEMID "\\init_mem_rd"
    parameter \ABITS 8
    parameter \WIDTH 32
    parameter \TRANSPARENCY_MASK 0'0
    parameter \COLLISION_X_MASK 0'0
    parameter \ARST_VALUE 32'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    parameter \SRST_VALUE 32'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    parameter \INIT_VALUE 32'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    parameter \CE_OVER_SRST 0
    parameter \CLK_ENABLE 1
    parameter \CLK_POLARITY 1
    connect \ADDR \default_idx [7:0]
    connect \DATA \default_word
    connect \ARST 1'0
    connect \SRST 1'0
    connect \EN \init_mem_r_en [0]
    connect \CLK \clk [0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:67"
  process $220
    assign \mem_addr [13:0] 14'00000000000000
    switch { \any_clist_access [0] \any_ns_access [0] }
      case 2'-1
        assign \mem_addr [13:0] 14'00000000000000
      case 2'1-
        assign \mem_addr [13:0] 14'00000000000000
      case
        assign \mem_addr [13:0] \dmem_addr [15:2]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:81"
  process $221
    assign \wr_data [31:0] 32'00000000000000000000000000000000
    switch 2'00
      case 2'-1
        assign \wr_data [31:0] 32'00000000000000000000000000000000
      case 2'1-
        assign \wr_data [31:0] \clist_wr_data [31:0]
      case
        assign \wr_data [31:0] \dmem_wr_data [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:82"
  process $222
    assign \wr_en [0] 1'0
    switch 2'00
      case 2'-1
        assign \wr_en [0] 1'1
      case 2'1-
        assign \wr_en [0] 1'1
      case
        assign \wr_en [0] \dmem_wr_en [0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:20"
  process $223
    assign \addr$31 [13:0] 14'00000000000000
    switch \load_done [0]
      case 1'1
        assign \addr$31 [13:0] \mem_addr [13:0]
    end
    switch \loader_fsm_state [2:0]
      case 3'000
      case 3'010
      case 3'011
        assign \addr$31 [13:0] { $1 [9] $1 [9] $1 [9] $1 [9] $1 [9:0] }
      case 3'001
      case 3'101
      case 3'110
        assign \addr$31 [13:0] { 5'00000 \load_words_received [8:0] }
      case 3'100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:21"
  process $224
    assign \wr_data$32 [31:0] 32'00000000000000000000000000000000
    switch \load_done [0]
      case 1'1
        assign \wr_data$32 [31:0] \wr_data [31:0]
    end
    switch \loader_fsm_state [2:0]
      case 3'000
      case 3'010
      case 3'011
        assign \wr_data$32 [31:0] \default_word [31:0]
      case 3'001
      case 3'101
      case 3'110
        assign \wr_data$32 [31:0] \load_word [31:0]
      case 3'100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:23"
  process $225
    assign \wr_en$33 [0] 1'0
    switch \load_done [0]
      case 1'1
        assign \wr_en$33 [0] \wr_en [0]
    end
    switch \loader_fsm_state [2:0]
      case 3'000
      case 3'010
      case 3'011
        assign \wr_en$33 [0] 1'1
      case 3'001
      case 3'101
      case 3'110
        assign \wr_en$33 [0] 1'1
      case 3'100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:117"
  process $226
    assign \init_mem_r_en [0] 1'1
    switch \loader_fsm_state [2:0]
      case 3'000
      case 3'010
        assign \init_mem_r_en [0] 1'1
      case 3'011
        switch $2 [0]
          case 1'1
          case
            assign \init_mem_r_en [0] 1'1
        end
      case 3'001
      case 3'101
      case 3'110
      case 3'100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:59"
  process $227
    assign \boot_start [0] 1'0
    switch $4 [0]
      case 1'1
        switch $5 [0]
          case 1'1
          case
            assign \boot_start [0] 1'1
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:92"
  process $228
    assign \byte_data [7:0] 8'00000000
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
        switch $17 [0]
          case 1'1
            switch $18 [0]
              case 1'1
                assign \byte_data [7:0] \banner_byte [7:0]
              case
            end
        end
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
            switch $21 [0]
              case 1'1
                assign \byte_data [7:0] \halt_byte [7:0]
              case
            end
        end
      case 4'0101
      case 4'0110
      case 4'0111
        switch $22 [0]
          case 1'1
            switch $23 [0]
              case 1'1
                assign \byte_data [7:0] \step_byte [7:0]
              case
            end
        end
      case 4'1000
      case 4'1001
        switch $25 [0]
          case 1'1
            switch $26 [0]
              case 1'1
                assign \byte_data [7:0] \fault_byte [7:0]
              case
            end
        end
      case 4'1010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:91"
  process $229
    assign \send_byte [0] 1'0
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
        switch $17 [0]
          case 1'1
            switch $18 [0]
              case 1'1
                assign \send_byte [0] 1'1
              case
            end
        end
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
            switch $21 [0]
              case 1'1
                assign \send_byte [0] 1'1
              case
            end
        end
      case 4'0101
      case 4'0110
      case 4'0111
        switch $22 [0]
          case 1'1
            switch $23 [0]
              case 1'1
                assign \send_byte [0] 1'1
              case
            end
        end
      case 4'1000
      case 4'1001
        switch $25 [0]
          case 1'1
            switch $26 [0]
              case 1'1
                assign \send_byte [0] 1'1
              case
            end
        end
      case 4'1010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:89"
  process $230
    assign \data$81 [31:0] 32'00000000000000000000000000000000
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
        switch $19 [0]
          case 1'1
            assign \data$81 [31:0] \imem_addr [31:0]
        end
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        switch $24 [0]
          case 1'1
            assign \data$81 [31:0] \step_nia [31:0]
        end
      case 4'1001
      case 4'1010
        switch $27 [0]
          case 1'1
            assign \data$81 [31:0] \fault_word [31:0]
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:90"
  process $231
    assign \send [0] 1'0
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
        switch $19 [0]
          case 1'1
            assign \send [0] 1'1
        end
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        switch $24 [0]
          case 1'1
            assign \send [0] 1'1
        end
      case 4'1001
      case 4'1010
        switch $27 [0]
          case 1'1
            assign \send [0] 1'1
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:394"
  process $232
    assign \fault_word [31:0] 32'00000000000000000000000000000000
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
        switch $27 [0]
          case 1'1
            assign \fault_word [31:0] { 28'0000000000000000000000000000 \step_fault [3:0] }
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:127"
  process $233
    assign $87 [23:0] \auto_boot_ctr [23:0]
    switch \loader_fsm_state [2:0]
      case 3'000
        assign $87 [23:0] $46 [23:0]
        switch { $47 [0] \valid [0] }
          case 2'-1
            switch $51 [0]
              case 1'1
                assign $87 [23:0] 24'000000000000000000000000
              case
            end
          case 2'1-
        end
      case 3'010
      case 3'011
      case 3'001
      case 3'101
      case 3'110
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $87 [23:0] 24'000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:127"
  cell $dff $234
    parameter \WIDTH 24
    parameter \CLK_POLARITY 1
    connect \D $87 [23:0]
    connect \CLK \clk [0]
    connect \Q \auto_boot_ctr
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:122"
  process $235
    assign $88 [31:0] \load_word [31:0]
    switch \loader_fsm_state [2:0]
      case 3'000
        switch { $47 [0] \valid [0] }
          case 2'-1
            switch { $50 [0] $49 [0] $48 [0] }
              case 3'--1
                assign $88 [7:0] \data$92 [7:0]
              case 3'-1-
                assign $88 [15:8] \data$92 [7:0]
              case 3'1--
                assign $88 [23:16] \data$92 [7:0]
              case
                assign $88 [31:24] \data$92 [7:0]
            end
          case 2'1-
        end
      case 3'010
      case 3'011
      case 3'001
        assign $88 [31:0] 32'00000000000000000000000000000000
      case 3'101
        switch \valid [0]
          case 1'1
            switch { $59 [0] $58 [0] $57 [0] }
              case 3'--1
                assign $88 [7:0] \data$92 [7:0]
              case 3'-1-
                assign $88 [15:8] \data$92 [7:0]
              case 3'1--
                assign $88 [23:16] \data$92 [7:0]
              case
                assign $88 [31:24] \data$92 [7:0]
            end
        end
      case 3'110
        assign $88 [31:0] 32'00000000000000000000000000000000
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $88 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:122"
  cell $dff $236
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $88 [31:0]
    connect \CLK \clk [0]
    connect \Q \load_word
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:125"
  process $237
    assign $89 [8:0] \load_words_received [8:0]
    switch \loader_fsm_state [2:0]
      case 3'000
        switch { $47 [0] \valid [0] }
          case 2'-1
            switch $51 [0]
              case 1'1
                assign $89 [8:0] 9'000000000
              case
            end
          case 2'1-
        end
      case 3'010
      case 3'011
      case 3'001
      case 3'101
      case 3'110
        assign $89 [8:0] $62 [8:0]
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $89 [8:0] 9'000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:125"
  cell $dff $238
    parameter \WIDTH 9
    parameter \CLK_POLARITY 1
    connect \D $89 [8:0]
    connect \CLK \clk [0]
    connect \Q \load_words_received
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:123"
  process $239
    assign $90 [1:0] \load_byte_idx [1:0]
    switch \loader_fsm_state [2:0]
      case 3'000
        switch { $47 [0] \valid [0] }
          case 2'-1
            switch $51 [0]
              case 1'1
                assign $90 [1:0] 2'00
              case
                assign $90 [1:0] $52 [1:0]
            end
          case 2'1-
        end
      case 3'010
      case 3'011
      case 3'001
      case 3'101
        switch \valid [0]
          case 1'1
            switch $60 [0]
              case 1'1
              case
                assign $90 [1:0] $61 [1:0]
            end
        end
      case 3'110
        assign $90 [1:0] 2'00
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $90 [1:0] 2'00
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:123"
  cell $dff $240
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $90 [1:0]
    connect \CLK \clk [0]
    connect \Q \load_byte_idx
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $241
    assign $91 [2:0] \loader_fsm_state [2:0]
    switch \loader_fsm_state [2:0]
      case 3'000
        switch { $47 [0] \valid [0] }
          case 2'-1
            switch $51 [0]
              case 1'1
                assign $91 [2:0] 3'001
              case
            end
          case 2'1-
            assign $91 [2:0] 3'010
        end
      case 3'010
        assign $91 [2:0] 3'011
      case 3'011
        switch $54 [0]
          case 1'1
            assign $91 [2:0] 3'100
          case
            assign $91 [2:0] 3'011
        end
      case 3'001
        assign $91 [2:0] 3'101
      case 3'101
        switch \valid [0]
          case 1'1
            switch $60 [0]
              case 1'1
                assign $91 [2:0] 3'110
              case
            end
        end
      case 3'110
        switch $64 [0]
          case 1'1
            assign $91 [2:0] 3'100
          case
            assign $91 [2:0] 3'101
        end
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $91 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $242
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $91 [2:0]
    connect \CLK \clk [0]
    connect \Q \loader_fsm_state
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:113"
  process $243
    assign $92 [8:0] \default_idx [8:0]
    switch \loader_fsm_state [2:0]
      case 3'000
      case 3'010
        assign $92 [8:0] $53 [8:0]
      case 3'011
        switch $54 [0]
          case 1'1
          case
            assign $92 [8:0] $55 [8:0]
        end
      case 3'001
      case 3'101
      case 3'110
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $92 [8:0] 9'000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:113"
  cell $dff $244
    parameter \WIDTH 9
    parameter \CLK_POLARITY 1
    connect \D $92 [8:0]
    connect \CLK \clk [0]
    connect \Q \default_idx
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:90"
  process $245
    assign $93 [0] \load_done [0]
    switch \loader_fsm_state [2:0]
      case 3'000
      case 3'010
      case 3'011
        switch $54 [0]
          case 1'1
            assign $93 [0] 1'1
          case
        end
      case 3'001
      case 3'101
      case 3'110
        switch $64 [0]
          case 1'1
            assign $93 [0] 1'1
          case
        end
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $93 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:90"
  cell $dff $246
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $93 [0]
    connect \CLK \clk [0]
    connect \Q \load_done
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:124"
  process $247
    assign $94 [8:0] \load_word_count [8:0]
    switch \loader_fsm_state [2:0]
      case 3'000
      case 3'010
      case 3'011
      case 3'001
        switch $56 [0]
          case 1'1
            assign $94 [8:0] \load_word [8:0]
          case
            assign $94 [8:0] 9'100000000
        end
      case 3'101
      case 3'110
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $94 [8:0] 9'000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:124"
  cell $dff $248
    parameter \WIDTH 9
    parameter \CLK_POLARITY 1
    connect \D $94 [8:0]
    connect \CLK \clk [0]
    connect \Q \load_word_count
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:219"
  process $249
    assign $95 [3:0] \boot_delay [3:0]
    switch $66 [0]
      case 1'1
        switch $67 [0]
          case 1'1
            assign $95 [3:0] $68 [3:0]
          case
        end
    end
    switch \rst [0]
      case 1'1
        assign $95 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:219"
  cell $dff $250
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $95 [3:0]
    connect \CLK \clk [0]
    connect \Q \boot_delay
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:220"
  process $251
    assign $96 [0] \boot_triggered [0]
    switch $66 [0]
      case 1'1
        switch $67 [0]
          case 1'1
          case
            assign $96 [0] 1'1
        end
    end
    switch \rst [0]
      case 1'1
        assign $96 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:220"
  cell $dff $252
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $96 [0]
    connect \CLK \clk [0]
    connect \Q \boot_triggered
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:231"
  process $253
    assign $97 [31:0] \imem_addr [31:0]
    switch \rst [0]
      case 1'1
        assign $97 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:231"
  cell $dff $254
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $97 [31:0]
    connect \CLK \clk [0]
    connect \Q \prev_nia
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:241"
  process $255
    assign $98 [2:0] \btn_sync [2:0]
    assign $98 [0] \push_button [0]
    assign $98 [1] \btn_sync [0]
    assign $98 [2] \btn_sync [1]
    switch \rst [0]
      case 1'1
        assign $98 [2:0] 3'000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:241"
  cell $dff $256
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $98 [2:0]
    connect \CLK \clk [0]
    connect \Q \btn_sync
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:242"
  process $257
    assign $99 [0] \btn_sync [2]
    switch \rst [0]
      case 1'1
        assign $99 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:242"
  cell $dff $258
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $99 [0]
    connect \CLK \clk [0]
    connect \Q \btn_prev
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:252"
  process $259
    assign $100 [22:0] $69 [22:0]
    switch \rst [0]
      case 1'1
        assign $100 [22:0] 23'00000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:252"
  cell $dff $260
    parameter \WIDTH 23
    parameter \CLK_POLARITY 1
    connect \D $100 [22:0]
    connect \CLK \clk [0]
    connect \Q \heartbeat_ctr
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:295"
  process $261
    assign $101 [25:0] \startup_ctr [25:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
        assign $101 [25:0] $70 [25:0]
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $101 [25:0] 26'00000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:295"
  cell $dff $262
    parameter \WIDTH 26
    parameter \CLK_POLARITY 1
    connect \D $101 [25:0]
    connect \CLK \clk [0]
    connect \Q \startup_ctr
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $263
    assign $102 [3:0] \debug_fsm_state [3:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
        switch $71 [0]
          case 1'1
            assign $102 [3:0] 4'0001
        end
      case 4'0001
        switch \boot_complete [0]
          case 1'1
            assign $102 [3:0] 4'0010
        end
      case 4'0010
        switch $72 [0]
          case 1'1
            switch $73 [0]
              case 1'1
              case
                assign $102 [3:0] 4'0011
            end
        end
      case 4'0011
        switch $75 [0]
          case 1'1
            assign $102 [3:0] 4'0100
        end
      case 4'0100
        switch $76 [0]
          case 1'1
            switch $77 [0]
              case 1'1
              case
                assign $102 [3:0] 4'0101
            end
        end
      case 4'0101
        switch \btn_press [0]
          case 1'1
            assign $102 [3:0] 4'0110
        end
      case 4'0110
        switch \step_complete [0]
          case 1'1
            assign $102 [3:0] 4'0111
        end
      case 4'0111
        switch $79 [0]
          case 1'1
            switch $80 [0]
              case 1'1
              case
                assign $102 [3:0] 4'1000
            end
        end
      case 4'1000
        switch $82 [0]
          case 1'1
            switch \step_had_fault [0]
              case 1'1
                assign $102 [3:0] 4'1001
              case
                assign $102 [3:0] 4'0100
            end
        end
      case 4'1001
        switch $83 [0]
          case 1'1
            switch $84 [0]
              case 1'1
              case
                assign $102 [3:0] 4'1010
            end
        end
      case 4'1010
        switch $86 [0]
          case 1'1
            assign $102 [3:0] 4'0100
        end
    end
    switch \rst [0]
      case 1'1
        assign $102 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $264
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $102 [3:0]
    connect \CLK \clk [0]
    connect \Q \debug_fsm_state
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:271"
  process $265
    assign $103 [3:0] \banner_idx [3:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
        switch \boot_complete [0]
          case 1'1
            assign $103 [3:0] 4'0000
        end
      case 4'0010
        switch $72 [0]
          case 1'1
            switch $73 [0]
              case 1'1
                assign $103 [3:0] $74 [3:0]
              case
            end
        end
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $103 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:271"
  cell $dff $266
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $103 [3:0]
    connect \CLK \clk [0]
    connect \Q \banner_idx
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:228"
  process $267
    assign $104 [0] \halted [0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
        switch \boot_complete [0]
          case 1'1
            assign $104 [0] 1'1
        end
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $104 [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:228"
  cell $dff $268
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $104 [0]
    connect \CLK \clk [0]
    connect \Q \halted
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:276"
  process $269
    assign $105 [2:0] \halt_idx [2:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
        switch $76 [0]
          case 1'1
            switch $77 [0]
              case 1'1
                assign $105 [2:0] $78 [2:0]
              case
                assign $105 [2:0] 3'000
            end
        end
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        switch $82 [0]
          case 1'1
            switch \step_had_fault [0]
              case 1'1
              case
                assign $105 [2:0] 3'000
            end
        end
      case 4'1001
      case 4'1010
        switch $86 [0]
          case 1'1
            assign $105 [2:0] 3'000
        end
    end
    switch \rst [0]
      case 1'1
        assign $105 [2:0] 3'000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:276"
  cell $dff $270
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $105 [2:0]
    connect \CLK \clk [0]
    connect \Q \halt_idx
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:229"
  process $271
    assign $106 [0] \stepping [0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
        switch \btn_press [0]
          case 1'1
            assign $106 [0] 1'1
        end
      case 4'0110
        switch \step_complete [0]
          case 1'1
            assign $106 [0] 1'0
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $106 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:229"
  cell $dff $272
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $106 [0]
    connect \CLK \clk [0]
    connect \Q \stepping
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:290"
  process $273
    assign $107 [31:0] \step_nia [31:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        switch \step_complete [0]
          case 1'1
            assign $107 [31:0] \imem_addr [31:0]
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $107 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:290"
  cell $dff $274
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $107 [31:0]
    connect \CLK \clk [0]
    connect \Q \step_nia
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:291"
  process $275
    assign $108 [3:0] \step_fault [3:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        switch \step_complete [0]
          case 1'1
            assign $108 [3:0] \fault [3:0]
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $108 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:291"
  cell $dff $276
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $108 [3:0]
    connect \CLK \clk [0]
    connect \Q \step_fault
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:292"
  process $277
    assign $109 [0] \step_had_fault [0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        switch \step_complete [0]
          case 1'1
            assign $109 [0] \led_r [0]
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $109 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:292"
  cell $dff $278
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $109 [0]
    connect \CLK \clk [0]
    connect \Q \step_had_fault
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:281"
  process $279
    assign $110 [1:0] \step_idx [1:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        switch \step_complete [0]
          case 1'1
            assign $110 [1:0] 2'00
        end
      case 4'0111
        switch $79 [0]
          case 1'1
            switch $80 [0]
              case 1'1
                assign $110 [1:0] $81 [1:0]
              case
                assign $110 [1:0] 2'00
            end
        end
      case 4'1000
      case 4'1001
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $110 [1:0] 2'00
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:281"
  cell $dff $280
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $110 [1:0]
    connect \CLK \clk [0]
    connect \Q \step_idx
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:286"
  process $281
    assign $111 [1:0] \fault_msg_idx [1:0]
    switch \debug_fsm_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        switch $82 [0]
          case 1'1
            switch \step_had_fault [0]
              case 1'1
                assign $111 [1:0] 2'00
              case
            end
        end
      case 4'1001
        switch $83 [0]
          case 1'1
            switch $84 [0]
              case 1'1
                assign $111 [1:0] $85 [1:0]
              case
                assign $111 [1:0] 2'00
            end
        end
      case 4'1010
    end
    switch \rst [0]
      case 1'1
        assign $111 [1:0] 2'00
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_test.py:286"
  cell $dff $282
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $111 [1:0]
    connect \CLK \clk [0]
    connect \Q \fault_msg_idx
  end

connect \tx \uart_tx [0]
connect \rx \uart_rx [0]
connect \addr \imem_addr [10:2]
connect \data \imem_data [31:0]
connect \ns_rd_en 1'0
connect \ns_wr_en 1'0
connect \clist_rd_en 1'0
connect \clist_wr_en 1'0
connect \ns_addr 32'00000000000000000000000000000000
connect \clist_addr 32'00000000000000000000000000000000
connect \ns_wr_data 96'000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \dmem_rd_data { $113 [15:0] $112 [15:0] }
connect \rd_data { $113 [15:0] $112 [15:0] }
connect \ns_rd_data { 64'0000000000000000000000000000000000000000000000000000000000000000 $113 [15:0] $112 [15:0] }
connect \clist_rd_data { $113 [15:0] $112 [15:0] }
connect \init_mem_r_addr \default_idx [7:0]
connect \init_mem_r_data \default_word [31:0]
connect \nia \imem_addr [31:0]
connect \gc_start 1'0
connect \heartbeat_blink \heartbeat_ctr [22]
connect \fault_valid \led_r [0]
connect \led_fault \led_r [0]
connect \r \led_r [0]
connect \clist_wr_data.gt_type \clist_wr_data [1:0]
connect \clist_wr_data.perms \clist_wr_data [7:2]
connect \clist_wr_data.index \clist_wr_data [24:8]
connect \clist_wr_data.version \clist_wr_data [31:25]
connect \clist_rd_data.gt_type $112 [1:0]
connect \clist_rd_data.perms $112 [7:2]
connect \clist_rd_data.index { $113 [8:0] $112 [15:8] }
connect \clist_rd_data.version $113 [15:9]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/uart_tx.py:97"
module \top.debug

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:23"
  wire width 1 \tx$1

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:109"
  wire width 4 \nibble_val

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:105"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \data_reg

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:106"
  attribute \init 4'0000
  wire width 4 \nibble_idx

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:110"
  wire width 8 \hex_byte

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \debug_printer_state

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:21"
  wire width 1 \busy$8

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:19"
  wire width 8 \data

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:20"
  wire width 1 \start

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:107"
  attribute \init 8'00000000
  wire width 8 \byte_reg

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:22"
  wire width 1 \done

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:92"
  wire width 8 input 2  \byte_data

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:91"
  wire width 1 input 3  \send_byte

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:89"
  wire width 32 input 4  \data$16

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:90"
  wire width 1 input 5  \send

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:93"
  wire width 1 output 6  \busy

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:23"
  wire width 1 output 7  \tx

  wire width 7 $1

  wire width 32 $2

  wire width 32 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 5 $16

  wire width 1 $17

  wire width 1 $18

  wire width 32 $19

  wire width 4 $20

  wire width 3 $21

  wire width 8 $22

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:100"
  cell \top.debug.uart \uart
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \data \data [7:0]
    connect \start \start [0]
    connect \tx \tx [0]
    connect \busy \busy$8 [0]
    connect \done \done [0]
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:111"
  cell $shl $23
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 7
    connect \A \nibble_idx [3:0]
    connect \B 2'10
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:111"
  cell $shr $24
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 7
    parameter \Y_WIDTH 32
    connect \A \data_reg [31:0]
    connect \B $1 [6:0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:111"
  cell $and $25
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 32
    parameter \Y_WIDTH 32
    connect \A $2 [31:0]
    connect \B 32'00000000000000000000000000001111
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:112"
  process $26
    assign \hex_byte [7:0] 8'00000000
    switch $3 [3:0]
      case 4'0000
        assign \hex_byte [7:0] 8'00110000
      case 4'0001
        assign \hex_byte [7:0] 8'00110001
      case 4'0010
        assign \hex_byte [7:0] 8'00110010
      case 4'0011
        assign \hex_byte [7:0] 8'00110011
      case 4'0100
        assign \hex_byte [7:0] 8'00110100
      case 4'0101
        assign \hex_byte [7:0] 8'00110101
      case 4'0110
        assign \hex_byte [7:0] 8'00110110
      case 4'0111
        assign \hex_byte [7:0] 8'00110111
      case 4'1000
        assign \hex_byte [7:0] 8'00111000
      case 4'1001
        assign \hex_byte [7:0] 8'00111001
      case 4'1010
        assign \hex_byte [7:0] 8'01000001
      case 4'1011
        assign \hex_byte [7:0] 8'01000010
      case 4'1100
        assign \hex_byte [7:0] 8'01000011
      case 4'1101
        assign \hex_byte [7:0] 8'01000100
      case 4'1110
        assign \hex_byte [7:0] 8'01000101
      case 4'1111
        assign \hex_byte [7:0] 8'01000110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:129"
  cell $not $27
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy$8 [0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:147"
  cell $not $28
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy$8 [0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:161"
  cell $not $29
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy$8 [0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \debug_printer_state [2:0]
    connect \B {  }
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \debug_printer_state [2:0]
    connect \B 1'1
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $32
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \debug_printer_state [2:0]
    connect \B 2'10
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \debug_printer_state [2:0]
    connect \B 2'11
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \debug_printer_state [2:0]
    connect \B 3'100
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \debug_printer_state [2:0]
    connect \B 3'101
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \debug_printer_state [2:0]
    connect \B 3'110
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:129"
  cell $not $37
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy$8 [0]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:139"
  cell $eq $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \nibble_idx [3:0]
    connect \B {  }
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:142"
  cell $sub $39
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 5
    connect \A \nibble_idx [3:0]
    connect \B 1'1
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:147"
  cell $not $40
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy$8 [0]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:161"
  cell $not $41
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \busy$8 [0]
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:93"
  process $42
    assign \busy [0] 1'0
    switch \debug_printer_state [2:0]
      case 3'000
        assign \busy [0] 1'0
      case 3'001
        assign \busy [0] 1'1
      case 3'011
        assign \busy [0] 1'1
      case 3'100
        assign \busy [0] 1'1
      case 3'101
        assign \busy [0] 1'1
      case 3'010
        assign \busy [0] 1'1
      case 3'110
        assign \busy [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:19"
  process $43
    assign \data [7:0] 8'00000000
    switch \debug_printer_state [2:0]
      case 3'000
      case 3'001
        switch $4 [0]
          case 1'1
            assign \data [7:0] \hex_byte [7:0]
        end
      case 3'011
      case 3'100
        switch $5 [0]
          case 1'1
            assign \data [7:0] 8'00001010
        end
      case 3'101
      case 3'010
        switch $6 [0]
          case 1'1
            assign \data [7:0] \byte_reg [7:0]
        end
      case 3'110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:20"
  process $44
    assign \start [0] 1'0
    switch \debug_printer_state [2:0]
      case 3'000
      case 3'001
        switch $4 [0]
          case 1'1
            assign \start [0] 1'1
        end
      case 3'011
      case 3'100
        switch $5 [0]
          case 1'1
            assign \start [0] 1'1
        end
      case 3'101
      case 3'010
        switch $6 [0]
          case 1'1
            assign \start [0] 1'1
        end
      case 3'110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:105"
  process $45
    assign $19 [31:0] \data_reg [31:0]
    switch \debug_printer_state [2:0]
      case 3'000
        switch { \send_byte [0] \send [0] }
          case 2'-1
            assign $19 [31:0] \data$16 [31:0]
          case 2'1-
        end
      case 3'001
      case 3'011
      case 3'100
      case 3'101
      case 3'010
      case 3'110
    end
    switch \rst [0]
      case 1'1
        assign $19 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:105"
  cell $dff $46
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $19 [31:0]
    connect \CLK \clk [0]
    connect \Q \data_reg
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:106"
  process $47
    assign $20 [3:0] \nibble_idx [3:0]
    switch \debug_printer_state [2:0]
      case 3'000
        switch { \send_byte [0] \send [0] }
          case 2'-1
            assign $20 [3:0] 4'0111
          case 2'1-
        end
      case 3'001
      case 3'011
        switch \done [0]
          case 1'1
            switch $15 [0]
              case 1'1
              case
                assign $20 [3:0] $16 [3:0]
            end
        end
      case 3'100
      case 3'101
      case 3'010
      case 3'110
    end
    switch \rst [0]
      case 1'1
        assign $20 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:106"
  cell $dff $48
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $20 [3:0]
    connect \CLK \clk [0]
    connect \Q \nibble_idx
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $49
    assign $21 [2:0] \debug_printer_state [2:0]
    switch \debug_printer_state [2:0]
      case 3'000
        switch { \send_byte [0] \send [0] }
          case 2'-1
            assign $21 [2:0] 3'001
          case 2'1-
            assign $21 [2:0] 3'010
        end
      case 3'001
        switch $14 [0]
          case 1'1
            assign $21 [2:0] 3'011
        end
      case 3'011
        switch \done [0]
          case 1'1
            switch $15 [0]
              case 1'1
                assign $21 [2:0] 3'100
              case
                assign $21 [2:0] 3'001
            end
        end
      case 3'100
        switch $17 [0]
          case 1'1
            assign $21 [2:0] 3'101
        end
      case 3'101
        switch \done [0]
          case 1'1
            assign $21 [2:0] 3'000
        end
      case 3'010
        switch $18 [0]
          case 1'1
            assign $21 [2:0] 3'110
        end
      case 3'110
        switch \done [0]
          case 1'1
            assign $21 [2:0] 3'000
        end
    end
    switch \rst [0]
      case 1'1
        assign $21 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $50
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $21 [2:0]
    connect \CLK \clk [0]
    connect \Q \debug_printer_state
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:107"
  process $51
    assign $22 [7:0] \byte_reg [7:0]
    switch \debug_printer_state [2:0]
      case 3'000
        switch { \send_byte [0] \send [0] }
          case 2'-1
          case 2'1-
            assign $22 [7:0] \byte_data [7:0]
        end
      case 3'001
      case 3'011
      case 3'100
      case 3'101
      case 3'010
      case 3'110
    end
    switch \rst [0]
      case 1'1
        assign $22 [7:0] 8'00000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:107"
  cell $dff $52
    parameter \WIDTH 8
    parameter \CLK_POLARITY 1
    connect \D $22 [7:0]
    connect \CLK \clk [0]
    connect \Q \byte_reg
  end

connect \tx$1 \tx [0]
connect \nibble_val $3 [3:0]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/uart_tx.py:26"
module \top.debug.uart

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 2'00
  wire width 2 \uart_tx_state

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:32"
  attribute \init 10'0000000000
  wire width 10 \shift_reg

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:30"
  attribute \init 7'0000000
  wire width 7 \counter

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:31"
  attribute \init 4'0000
  wire width 4 \bit_pos

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:19"
  wire width 8 input 2  \data

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:20"
  wire width 1 input 3  \start

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:23"
  wire width 1 output 4  \tx

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:21"
  wire width 1 output 5  \busy

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:22"
  wire width 1 output 6  \done

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 10 $5

  wire width 5 $6

  wire width 1 $7

  wire width 8 $8

  wire width 10 $9

  wire width 7 $10

  wire width 4 $11

  wire width 2 $12

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $13
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \uart_tx_state [1:0]
    connect \B {  }
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $14
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \uart_tx_state [1:0]
    connect \B 1'1
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \uart_tx_state [1:0]
    connect \B 2'10
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:55"
  cell $eq $16
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 7
    parameter \Y_WIDTH 1
    connect \A \counter [6:0]
    connect \B 7'1100111
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:58"
  cell $shr $17
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 10
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 10
    connect \A \shift_reg [9:0]
    connect \B 1'1
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:59"
  cell $add $18
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 5
    connect \A \bit_pos [3:0]
    connect \B 1'1
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:61"
  cell $eq $19
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \bit_pos [3:0]
    connect \B 4'1001
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:64"
  cell $add $20
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 8
    connect \A \counter [6:0]
    connect \B 1'1
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:23"
  process $21
    assign \tx [0] 1'1
    switch \uart_tx_state [1:0]
      case 2'00
        assign \tx [0] 1'1
      case 2'01
        assign \tx [0] \shift_reg [0]
      case 2'10
        assign \tx [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:21"
  process $22
    assign \busy [0] 1'0
    switch \uart_tx_state [1:0]
      case 2'00
        assign \busy [0] 1'0
      case 2'01
        assign \busy [0] 1'1
      case 2'10
        assign \busy [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:22"
  process $23
    assign \done [0] 1'0
    switch \uart_tx_state [1:0]
      case 2'00
        assign \done [0] 1'0
      case 2'01
        assign \done [0] 1'0
      case 2'10
        assign \done [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:32"
  process $24
    assign $9 [9:0] \shift_reg [9:0]
    switch \uart_tx_state [1:0]
      case 2'00
        switch \start [0]
          case 1'1
            assign $9 [9:0] { 1'1 \data [7:0] 1'0 }
        end
      case 2'01
        switch $4 [0]
          case 1'1
            assign $9 [9:0] $5 [9:0]
          case
        end
      case 2'10
    end
    switch \rst [0]
      case 1'1
        assign $9 [9:0] 10'0000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:32"
  cell $dff $25
    parameter \WIDTH 10
    parameter \CLK_POLARITY 1
    connect \D $9 [9:0]
    connect \CLK \clk [0]
    connect \Q \shift_reg
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:30"
  process $26
    assign $10 [6:0] \counter [6:0]
    switch \uart_tx_state [1:0]
      case 2'00
        switch \start [0]
          case 1'1
            assign $10 [6:0] 7'0000000
        end
      case 2'01
        switch $4 [0]
          case 1'1
            assign $10 [6:0] 7'0000000
          case
            assign $10 [6:0] $8 [6:0]
        end
      case 2'10
    end
    switch \rst [0]
      case 1'1
        assign $10 [6:0] 7'0000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:30"
  cell $dff $27
    parameter \WIDTH 7
    parameter \CLK_POLARITY 1
    connect \D $10 [6:0]
    connect \CLK \clk [0]
    connect \Q \counter
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:31"
  process $28
    assign $11 [3:0] \bit_pos [3:0]
    switch \uart_tx_state [1:0]
      case 2'00
        switch \start [0]
          case 1'1
            assign $11 [3:0] 4'0000
        end
      case 2'01
        switch $4 [0]
          case 1'1
            assign $11 [3:0] $6 [3:0]
          case
        end
      case 2'10
    end
    switch \rst [0]
      case 1'1
        assign $11 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_tx.py:31"
  cell $dff $29
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $11 [3:0]
    connect \CLK \clk [0]
    connect \Q \bit_pos
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $30
    assign $12 [1:0] \uart_tx_state [1:0]
    switch \uart_tx_state [1:0]
      case 2'00
        switch \start [0]
          case 1'1
            assign $12 [1:0] 2'01
        end
      case 2'01
        switch $4 [0]
          case 1'1
            switch $7 [0]
              case 1'1
                assign $12 [1:0] 2'10
            end
          case
        end
      case 2'10
        assign $12 [1:0] 2'00
    end
    switch \rst [0]
      case 1'1
        assign $12 [1:0] 2'00
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $31
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $12 [1:0]
    connect \CLK \clk [0]
    connect \Q \uart_tx_state
  end

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/uart_rx.py:25"
module \top.uart_rx$98

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:34"
  attribute \init 2'11
  wire width 2 \rx_sync

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \uart_rx_state

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:30"
  attribute \init 7'0000000
  wire width 7 \counter

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:31"
  attribute \init 4'0000
  wire width 4 \bit_pos

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:32"
  attribute \init 8'00000000
  wire width 8 \shift_reg

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:22"
  wire width 1 \error

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:19"
  wire width 1 input 0  \rx

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \rst

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:20"
  attribute \init 8'00000000
  wire width 8 output 3  \data

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:21"
  wire width 1 output 4  \valid

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 8 $4

  wire width 1 $5

  wire width 5 $6

  wire width 1 $7

  wire width 8 $8

  wire width 1 $9

  wire width 8 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 2 $17

  wire width 7 $18

  wire width 3 $19

  wire width 4 $20

  wire width 8 $21

  wire width 8 $22

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:44"
  cell $not $23
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \rx_sync [1]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:50"
  cell $eq $24
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A \counter [6:0]
    connect \B 6'110011
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:51"
  cell $not $25
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \rx_sync [1]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:57"
  cell $add $26
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 8
    connect \A \counter [6:0]
    connect \B 1'1
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:61"
  cell $eq $27
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 7
    parameter \Y_WIDTH 1
    connect \A \counter [6:0]
    connect \B 7'1100111
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:65"
  cell $add $28
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 5
    connect \A \bit_pos [3:0]
    connect \B 1'1
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:67"
  cell $eq $29
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \bit_pos [3:0]
    connect \B 3'111
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:70"
  cell $add $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 8
    connect \A \counter [6:0]
    connect \B 1'1
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:74"
  cell $eq $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 7
    parameter \Y_WIDTH 1
    connect \A \counter [6:0]
    connect \B 7'1100111
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:81"
  cell $add $32
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 7
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 8
    connect \A \counter [6:0]
    connect \B 1'1
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \uart_rx_state [2:0]
    connect \B {  }
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \uart_rx_state [2:0]
    connect \B 1'1
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \uart_rx_state [2:0]
    connect \B 2'10
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \uart_rx_state [2:0]
    connect \B 2'11
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \uart_rx_state [2:0]
    connect \B 3'100
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \uart_rx_state [2:0]
    connect \B 3'101
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:34"
  process $39
    assign $17 [1:0] \rx_sync [1:0]
    assign $17 [0] \rx [0]
    assign $17 [1] \rx_sync [0]
    switch \rst [0]
      case 1'1
        assign $17 [1:0] 2'11
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:34"
  cell $dff $40
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $17 [1:0]
    connect \CLK \clk [0]
    connect \Q \rx_sync
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:30"
  process $41
    assign $18 [6:0] \counter [6:0]
    switch \uart_rx_state [2:0]
      case 3'000
        switch $1 [0]
          case 1'1
            assign $18 [6:0] 7'0000000
        end
      case 3'001
        switch $2 [0]
          case 1'1
            switch $3 [0]
              case 1'1
                assign $18 [6:0] 7'0000000
              case
            end
          case
            assign $18 [6:0] $4 [6:0]
        end
      case 3'010
        switch $5 [0]
          case 1'1
            assign $18 [6:0] 7'0000000
          case
            assign $18 [6:0] $8 [6:0]
        end
      case 3'011
        switch $9 [0]
          case 1'1
          case
            assign $18 [6:0] $10 [6:0]
        end
      case 3'100
      case 3'101
    end
    switch \rst [0]
      case 1'1
        assign $18 [6:0] 7'0000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:30"
  cell $dff $42
    parameter \WIDTH 7
    parameter \CLK_POLARITY 1
    connect \D $18 [6:0]
    connect \CLK \clk [0]
    connect \Q \counter
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $43
    assign $19 [2:0] \uart_rx_state [2:0]
    switch \uart_rx_state [2:0]
      case 3'000
        switch $1 [0]
          case 1'1
            assign $19 [2:0] 3'001
        end
      case 3'001
        switch $2 [0]
          case 1'1
            switch $3 [0]
              case 1'1
                assign $19 [2:0] 3'010
              case
                assign $19 [2:0] 3'000
            end
          case
        end
      case 3'010
        switch $5 [0]
          case 1'1
            switch $7 [0]
              case 1'1
                assign $19 [2:0] 3'011
            end
          case
        end
      case 3'011
        switch $9 [0]
          case 1'1
            switch \rx_sync [1]
              case 1'1
                assign $19 [2:0] 3'100
              case
                assign $19 [2:0] 3'101
            end
          case
        end
      case 3'100
        assign $19 [2:0] 3'000
      case 3'101
        assign $19 [2:0] 3'000
    end
    switch \rst [0]
      case 1'1
        assign $19 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $44
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $19 [2:0]
    connect \CLK \clk [0]
    connect \Q \uart_rx_state
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:31"
  process $45
    assign $20 [3:0] \bit_pos [3:0]
    switch \uart_rx_state [2:0]
      case 3'000
      case 3'001
        switch $2 [0]
          case 1'1
            switch $3 [0]
              case 1'1
                assign $20 [3:0] 4'0000
              case
            end
          case
        end
      case 3'010
        switch $5 [0]
          case 1'1
            assign $20 [3:0] $6 [3:0]
          case
        end
      case 3'011
      case 3'100
      case 3'101
    end
    switch \rst [0]
      case 1'1
        assign $20 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:31"
  cell $dff $46
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $20 [3:0]
    connect \CLK \clk [0]
    connect \Q \bit_pos
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:32"
  process $47
    assign $21 [7:0] \shift_reg [7:0]
    switch \uart_rx_state [2:0]
      case 3'000
      case 3'001
      case 3'010
        switch $5 [0]
          case 1'1
            assign $21 [7:0] { \rx_sync [1] \shift_reg [7:1] }
          case
        end
      case 3'011
      case 3'100
      case 3'101
    end
    switch \rst [0]
      case 1'1
        assign $21 [7:0] 8'00000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:32"
  cell $dff $48
    parameter \WIDTH 8
    parameter \CLK_POLARITY 1
    connect \D $21 [7:0]
    connect \CLK \clk [0]
    connect \Q \shift_reg
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:20"
  process $49
    assign $22 [7:0] \data [7:0]
    switch \uart_rx_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'011
        switch $9 [0]
          case 1'1
            switch \rx_sync [1]
              case 1'1
                assign $22 [7:0] \shift_reg [7:0]
              case
            end
          case
        end
      case 3'100
      case 3'101
    end
    switch \rst [0]
      case 1'1
        assign $22 [7:0] 8'00000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:20"
  cell $dff $50
    parameter \WIDTH 8
    parameter \CLK_POLARITY 1
    connect \D $22 [7:0]
    connect \CLK \clk [0]
    connect \Q \data
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:21"
  process $51
    assign \valid [0] 1'0
    switch \uart_rx_state [2:0]
      case 3'000
        assign \valid [0] 1'0
      case 3'001
        assign \valid [0] 1'0
      case 3'010
        assign \valid [0] 1'0
      case 3'011
        assign \valid [0] 1'0
      case 3'100
        assign \valid [0] 1'1
      case 3'101
        assign \valid [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/uart_rx.py:22"
  process $52
    assign \error [0] 1'0
    switch \uart_rx_state [2:0]
      case 3'000
        assign \error [0] 1'0
      case 3'001
        assign \error [0] 1'0
      case 3'010
        assign \error [0] 1'0
      case 3'011
        assign \error [0] 1'0
      case 3'100
        assign \error [0] 1'0
      case 3'101
        assign \error [0] 1'1
    end
  end

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/pico_ice.py:77"
module \top.rgb

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:73"
  wire width 1 input 0  \g

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:74"
  wire width 1 input 1  \b

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:72"
  wire width 1 input 2  \r

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:79"
  cell \SB_RGBA_DRV \rgb_drv
    parameter \CURRENT_MODE "0b1"
    parameter \RGB0_CURRENT "0b000001"
    parameter \RGB1_CURRENT "0b000001"
    parameter \RGB2_CURRENT "0b000001"
    connect \CURREN 1'1
    connect \RGBLEDEN 1'1
    connect \RGB0PWM \g [0]
    connect \RGB1PWM \b [0]
    connect \RGB2PWM \r [0]
    connect \RGB0 $1
    connect \RGB1 $2
    connect \RGB2 $3
  end

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/core.py:74"
module \top.core

  attribute \src "/home/runner/workspace/church_machine/core.py:60"
  attribute \init 3'000
  wire width 3 \boot_state

  attribute \src "/home/runner/workspace/church_machine/core.py:118"
  attribute \init 3'000
  wire width 3 \boot_state_reg

  attribute \src "/home/runner/workspace/church_machine/core.py:119"
  wire width 1 \clear_all

  attribute \src "/home/runner/workspace/church_machine/core.py:38"
  wire width 32 \imem_data

  attribute \src "/home/runner/workspace/church_machine/decoder.py:23"
  wire width 1 \instr_valid

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 4 \flags

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 4 \flags$9

  attribute \src "/home/runner/workspace/church_machine/core.py:158"
  wire width 1 \cond_exec_enable

  attribute \src "/home/runner/workspace/church_machine/decoder.py:26"
  wire width 1 \exec_enable

  attribute \src "/home/runner/workspace/church_machine/core.py:161"
  wire width 1 \any_unit_busy

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:12"
  wire width 1 \lambda_busy

  attribute \src "/home/runner/workspace/church_machine/tperm.py:14"
  wire width 1 \tperm_busy

  attribute \src "/home/runner/workspace/church_machine/call.py:14"
  wire width 1 \call_busy

  attribute \src "/home/runner/workspace/church_machine/ret.py:12"
  wire width 1 \busy

  attribute \src "/home/runner/workspace/church_machine/save.py:15"
  wire width 1 \save_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:12"
  wire width 1 \load_busy

  attribute \src "/home/runner/workspace/church_machine/core.py:174"
  wire width 1 \lambda_start_sig

  attribute \src "/home/runner/workspace/church_machine/decoder.py:27"
  wire width 1 \is_church_op

  attribute \src "/home/runner/workspace/church_machine/decoder.py:29"
  wire width 5 \church_op

  attribute \src "/home/runner/workspace/church_machine/registers.py:20"
  wire width 4 \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:19"
  wire width 1 \sub_busy

  attribute \src "/home/runner/workspace/church_machine/decoder.py:31"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/save.py:20"
  wire width 4 \cr_rd_addr$25

  attribute \src "/home/runner/workspace/church_machine/ret.py:18"
  wire width 4 \cr_rd_addr$26

  attribute \src "/home/runner/workspace/church_machine/call.py:19"
  wire width 4 \cr_rd_addr$27

  attribute \src "/home/runner/workspace/church_machine/tperm.py:19"
  wire width 4 \cr_rd_addr$28

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:17"
  wire width 4 \cr_rd_addr$29

  attribute \src "/home/runner/workspace/church_machine/mload.py:24"
  wire width 4 \cr_rd_addr$30

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 128 \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/core.py:205"
  wire width 6 \required_perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 32 \gt_in

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:11"
  wire width 6 \required_perms$35

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:12"
  wire width 1 \check_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:34"
  wire width 1 \check_domain_purity

  attribute \src "/home/runner/workspace/church_machine/core.py:64"
  wire width 1 \gc_busy

  attribute \src "/home/runner/workspace/church_machine/core.py:65"
  wire width 32 \gc_garbage_count

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 32 \cr_rd_data_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:53"
  wire width 32 \clist_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:54"
  wire width 1 \clist_rd_en

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 32 \clist_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:57"
  wire width 1 \clist_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 4 \flags_in

  attribute \src "/home/runner/workspace/church_machine/registers.py:54"
  wire width 1 \flags_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:56"
  wire width 1 \clear_all$47

  attribute \src "/home/runner/workspace/church_machine/registers.py:48"
  wire width 4 \dr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:49"
  wire width 32 \dr_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:50"
  wire width 1 \dr_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:23"
  wire width 4 \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:29"
  wire width 1 \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/tperm.py:24"
  wire width 1 \cr_wr_en$53

  attribute \src "/home/runner/workspace/church_machine/call.py:23"
  wire width 1 \cr_wr_en$54

  attribute \src "/home/runner/workspace/church_machine/ret.py:22"
  wire width 1 \cr_wr_en$55

  attribute \src "/home/runner/workspace/church_machine/ret.py:20"
  wire width 4 \cr_wr_addr$56

  attribute \src "/home/runner/workspace/church_machine/call.py:21"
  wire width 4 \cr_wr_addr$57

  attribute \src "/home/runner/workspace/church_machine/tperm.py:22"
  wire width 4 \cr_wr_addr$58

  attribute \src "/home/runner/workspace/church_machine/mload.py:27"
  wire width 4 \cr_wr_addr$59

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 128 \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 128 \cr_wr_data$61

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 128 \cr_wr_data$62

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 128 \cr_wr_data$63

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 128 \cr_wr_data$64

  attribute \src "/home/runner/workspace/church_machine/registers.py:25"
  wire width 1 \cr_wr_en$65

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \nia_reg

  attribute \src "/home/runner/workspace/church_machine/core.py:70"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \nia

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 4 \flags$69

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 32 \ns_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr15_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr15_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 32 \thrd_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr8_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr8_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 32 \cr6_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr6_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr6_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 32 \slot3_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 32 \cr7_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr7_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr7_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr0_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr0_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr0_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr0_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr0_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr0_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr1_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr1_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr1_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr1_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr1_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr1_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr2_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr2_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr2_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr2_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr2_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr2_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr3_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr3_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr3_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr3_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr3_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr3_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr4_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr4_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr4_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr4_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr4_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr4_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr5_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr5_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr5_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr5_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr5_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr5_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr6_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr6_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr6_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr6_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr7_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr7_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr7_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr7_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr8_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr8_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr8_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr8_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr9_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr9_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr9_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr9_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr9_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr9_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr10_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr10_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr10_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr10_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr10_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr10_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr11_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr11_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr11_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr11_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr11_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr11_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr12_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr12_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr12_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr12_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr12_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr12_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr13_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr13_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr13_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr13_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr13_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr13_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr14_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  wire width 1 \boot_cr14_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr14_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr14_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr14_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 32 \boot_cr14_wr_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 \cr15_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:394"
  wire width 1 \rt_cr15_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 \cr15_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 32 \rt_cr15_wr_gt

  attribute \src "/home/runner/workspace/church_machine/core.py:180"
  wire width 1 \call_start_sig

  attribute \src "/home/runner/workspace/church_machine/call.py:10"
  wire width 1 \call_start

  attribute \src "/home/runner/workspace/church_machine/call.py:11"
  wire width 4 \cr_src$173

  attribute \src "/home/runner/workspace/church_machine/call.py:12"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/decoder.py:35"
  wire width 15 \cap_index

  attribute \src "/home/runner/workspace/church_machine/call.py:13"
  wire width 16 \mask

  attribute \src "/home/runner/workspace/church_machine/decoder.py:36"
  wire width 15 \call_mask

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 128 \cr_rd_data$178

  attribute \src "/home/runner/workspace/church_machine/core.py:181"
  wire width 1 \ret_start_sig

  attribute \src "/home/runner/workspace/church_machine/ret.py:10"
  wire width 1 \return_start

  attribute \src "/home/runner/workspace/church_machine/ret.py:11"
  wire width 3 \cr_src$181

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 128 \cr_rd_data$182

  attribute \src "/home/runner/workspace/church_machine/ret.py:39"
  attribute \init 1'0
  wire width 1 \lambda_active

  attribute \src "/home/runner/workspace/church_machine/core.py:115"
  attribute \init 1'0
  wire width 1 \lambda_active_reg

  attribute \src "/home/runner/workspace/church_machine/ret.py:40"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \lambda_pc

  attribute \src "/home/runner/workspace/church_machine/core.py:116"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \lambda_pc_reg

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:10"
  wire width 1 \lambda_start

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:11"
  wire width 4 \cr_target

  attribute \src "/home/runner/workspace/church_machine/decoder.py:30"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 128 \cr_rd_data$190

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:22"
  wire width 32 \saved_nia

  attribute \src "/home/runner/workspace/church_machine/core.py:179"
  wire width 1 \tperm_start_sig

  attribute \src "/home/runner/workspace/church_machine/tperm.py:10"
  wire width 1 \tperm_start

  attribute \src "/home/runner/workspace/church_machine/tperm.py:11"
  wire width 4 \cr_target$194

  attribute \src "/home/runner/workspace/church_machine/tperm.py:12"
  wire width 4 \preset

  attribute \src "/home/runner/workspace/church_machine/decoder.py:34"
  wire width 4 \tperm_preset

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 128 \cr_rd_data$197

  attribute \src "/home/runner/workspace/church_machine/core.py:467"
  wire width 1 \save_start_sig

  attribute \src "/home/runner/workspace/church_machine/save.py:11"
  wire width 1 \save_start

  attribute \src "/home/runner/workspace/church_machine/save.py:12"
  wire width 4 \cr_src$200

  attribute \src "/home/runner/workspace/church_machine/save.py:13"
  wire width 4 \cr_dst$201

  attribute \src "/home/runner/workspace/church_machine/save.py:14"
  wire width 17 \index$202

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 128 \cr_rd_data$203

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 128 \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 128 \cr15_namespace$205

  attribute \src "/home/runner/workspace/church_machine/save.py:26"
  wire width 1 \mem_wr_done

  attribute \src "/home/runner/workspace/church_machine/save.py:30"
  wire width 32 \mem_rd_data

  attribute \src "/home/runner/workspace/church_machine/core.py:43"
  wire width 32 \dmem_rd_data

  attribute \src "/home/runner/workspace/church_machine/save.py:31"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/core.py:483"
  wire width 1 \load_start_sig

  attribute \src "/home/runner/workspace/church_machine/load.py:8"
  wire width 1 \load_start

  attribute \src "/home/runner/workspace/church_machine/load.py:9"
  wire width 4 \cr_src$212

  attribute \src "/home/runner/workspace/church_machine/load.py:10"
  wire width 4 \cr_dst$213

  attribute \src "/home/runner/workspace/church_machine/load.py:11"
  wire width 17 \index$214

  attribute \src "/home/runner/workspace/church_machine/decoder.py:40"
  wire width 1 \fault_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:32"
  wire width 1 \fault_valid$216

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:14"
  wire width 1 \lambda_fault

  attribute \src "/home/runner/workspace/church_machine/tperm.py:16"
  wire width 1 \tperm_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:16"
  wire width 1 \call_fault

  attribute \src "/home/runner/workspace/church_machine/ret.py:14"
  wire width 1 \fault_valid$220

  attribute \src "/home/runner/workspace/church_machine/save.py:17"
  wire width 1 \save_fault

  attribute \src "/home/runner/workspace/church_machine/load.py:14"
  wire width 1 \load_fault

  attribute \src "/home/runner/workspace/church_machine/decoder.py:39"
  wire width 4 \fault$224

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:31"
  wire width 4 \fault_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:15"
  wire width 4 \fault_type$227

  attribute \src "/home/runner/workspace/church_machine/tperm.py:17"
  wire width 4 \fault_type$228

  attribute \src "/home/runner/workspace/church_machine/call.py:17"
  wire width 4 \fault_type$229

  attribute \src "/home/runner/workspace/church_machine/ret.py:15"
  wire width 4 \fault_type$230

  attribute \src "/home/runner/workspace/church_machine/save.py:18"
  wire width 4 \fault_type$231

  attribute \src "/home/runner/workspace/church_machine/load.py:15"
  wire width 4 \fault_type$232

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 128 \cr_rd_data$233

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 128 \cr15_namespace$234

  attribute \src "/home/runner/workspace/church_machine/mload.py:35"
  wire width 32 \mem_rd_data$235

  attribute \src "/home/runner/workspace/church_machine/mload.py:36"
  wire width 1 \mem_rd_valid$236

  attribute \src "/home/runner/workspace/church_machine/mload.py:12"
  wire width 1 \sub_start

  attribute \src "/home/runner/workspace/church_machine/call.py:25"
  wire width 1 \mload_start

  attribute \src "/home/runner/workspace/church_machine/mload.py:13"
  wire width 4 \sub_cr_src

  attribute \src "/home/runner/workspace/church_machine/call.py:26"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/mload.py:14"
  wire width 4 \sub_cr_dst

  attribute \src "/home/runner/workspace/church_machine/call.py:27"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/mload.py:15"
  wire width 17 \sub_index

  attribute \src "/home/runner/workspace/church_machine/call.py:28"
  wire width 17 \mload_index

  attribute \src "/home/runner/workspace/church_machine/mload.py:16"
  wire width 1 \sub_direct

  attribute \src "/home/runner/workspace/church_machine/call.py:29"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/mload.py:17"
  wire width 32 \sub_direct_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:30"
  wire width 32 \mload_direct_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:18"
  wire width 1 \sub_m_elevated

  attribute \src "/home/runner/workspace/church_machine/call.py:31"
  wire width 1 \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/ret.py:27"
  wire width 1 \mload_start$251

  attribute \src "/home/runner/workspace/church_machine/ret.py:28"
  wire width 4 \mload_cr_src$252

  attribute \src "/home/runner/workspace/church_machine/ret.py:29"
  wire width 4 \mload_cr_dst$253

  attribute \src "/home/runner/workspace/church_machine/ret.py:30"
  wire width 17 \mload_index$254

  attribute \src "/home/runner/workspace/church_machine/ret.py:31"
  wire width 1 \mload_direct$255

  attribute \src "/home/runner/workspace/church_machine/ret.py:32"
  wire width 32 \mload_direct_gt$256

  attribute \src "/home/runner/workspace/church_machine/ret.py:33"
  wire width 1 \mload_m_elevated$257

  attribute \src "/home/runner/workspace/church_machine/load.py:17"
  wire width 1 \mload_start$258

  attribute \src "/home/runner/workspace/church_machine/load.py:18"
  wire width 4 \mload_cr_src$259

  attribute \src "/home/runner/workspace/church_machine/load.py:19"
  wire width 4 \mload_cr_dst$260

  attribute \src "/home/runner/workspace/church_machine/load.py:20"
  wire width 17 \mload_index$261

  attribute \src "/home/runner/workspace/church_machine/load.py:21"
  wire width 1 \mload_direct$262

  attribute \src "/home/runner/workspace/church_machine/load.py:22"
  wire width 32 \mload_direct_gt$263

  attribute \src "/home/runner/workspace/church_machine/load.py:23"
  wire width 1 \mload_m_elevated$264

  attribute \src "/home/runner/workspace/church_machine/call.py:33"
  wire width 1 \mload_done

  attribute \src "/home/runner/workspace/church_machine/mload.py:20"
  wire width 1 \sub_done

  attribute \src "/home/runner/workspace/church_machine/call.py:34"
  wire width 1 \mload_fault

  attribute \src "/home/runner/workspace/church_machine/mload.py:21"
  wire width 1 \sub_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:35"
  wire width 4 \mload_fault_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:22"
  wire width 4 \sub_fault_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:35"
  wire width 1 \mload_done$271

  attribute \src "/home/runner/workspace/church_machine/ret.py:36"
  wire width 1 \mload_fault$272

  attribute \src "/home/runner/workspace/church_machine/ret.py:37"
  wire width 4 \mload_fault_type$273

  attribute \src "/home/runner/workspace/church_machine/load.py:25"
  wire width 1 \mload_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:26"
  wire width 1 \mload_done$275

  attribute \src "/home/runner/workspace/church_machine/load.py:27"
  wire width 1 \mload_fault$276

  attribute \src "/home/runner/workspace/church_machine/load.py:28"
  wire width 4 \mload_fault_type$277

  attribute \src "/home/runner/workspace/church_machine/core.py:42"
  wire width 1 \dmem_rd_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:34"
  wire width 1 \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:37"
  wire width 1 \mem_wr_en

  attribute \src "/home/runner/workspace/church_machine/save.py:25"
  wire width 1 \mem_wr_en$284

  attribute \src "/home/runner/workspace/church_machine/save.py:29"
  wire width 1 \mem_rd_en$285

  attribute \src "/home/runner/workspace/church_machine/mload.py:33"
  wire width 32 \mem_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:38"
  wire width 32 \mem_wr_data

  attribute \src "/home/runner/workspace/church_machine/save.py:23"
  wire width 32 \mem_wr_addr

  attribute \src "/home/runner/workspace/church_machine/save.py:24"
  wire width 32 \mem_wr_data$289

  attribute \src "/home/runner/workspace/church_machine/save.py:28"
  wire width 32 \mem_rd_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:47"
  wire width 32 \ns_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:48"
  wire width 1 \ns_rd_en

  attribute \src "/home/runner/workspace/church_machine/core.py:50"
  wire width 96 \ns_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:51"
  wire width 1 \ns_wr_en

  attribute \src "/home/runner/workspace/church_machine/ret.py:16"
  wire width 1 \reboot_request

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:20"
  wire width 1 \nia_set

  attribute \src "/home/runner/workspace/church_machine/ret.py:24"
  wire width 1 \nia_set$300

  attribute \src "/home/runner/workspace/church_machine/call.py:37"
  wire width 1 \nia_set$301

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:21"
  wire width 32 \nia_value

  attribute \src "/home/runner/workspace/church_machine/ret.py:25"
  wire width 32 \nia_value$303

  attribute \src "/home/runner/workspace/church_machine/call.py:38"
  wire width 32 \nia_value$304

  attribute \src "/home/runner/workspace/church_machine/ret.py:41"
  wire width 1 \lambda_clear

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:13"
  wire width 1 \lambda_complete

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/core.py:39"
  wire width 1 input 2  \imem_valid

  attribute \src "/home/runner/workspace/church_machine/core.py:61"
  wire width 1 output 3  \boot_complete

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 32 output 4  \perm_gt_sig

  wire width 16 input 5  \port$1202$0

  wire width 16 input 6  \port$1203$0

  attribute \src "/home/runner/workspace/church_machine/core.py:59"
  wire width 1 input 7  \boot_start

  attribute \src "/home/runner/workspace/church_machine/core.py:67"
  wire width 4 output 8  \fault

  attribute \src "/home/runner/workspace/church_machine/core.py:68"
  wire width 1 output 9  \fault_valid$225

  attribute \src "/home/runner/workspace/church_machine/core.py:41"
  wire width 32 output 10  \dmem_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:44"
  wire width 32 output 11  \dmem_wr_data

  attribute \src "/home/runner/workspace/church_machine/core.py:45"
  wire width 1 output 12  \dmem_wr_en

  attribute \src "/home/runner/workspace/church_machine/core.py:70"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 output 13  \imem_addr

  attribute \src "/home/runner/workspace/church_machine/core.py:38"
  wire width 32 input 14  \instruction

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 4 $10

  wire width 4 $11

  wire width 4 $12

  wire width 4 $13

  wire width 4 $14

  wire width 1 $15

  wire width 4 $16

  wire width 1 $17

  wire width 1 $18

  wire width 4 $19

  wire width 4 $20

  wire width 4 $21

  wire width 128 $22

  wire width 128 $23

  wire width 128 $24

  wire width 1 $25

  wire width 1 $26

  wire width 1 $27

  wire width 1 $28

  wire width 1 $29

  wire width 1 $30

  wire width 1 $31

  wire width 1 $32

  wire width 1 $33

  wire width 1 $34

  wire width 1 $35

  wire width 33 $36

  wire width 1 $37

  wire width 1 $38

  wire width 1 $39

  wire width 1 $40

  wire width 1 $41

  wire width 1 $42

  wire width 1 $43

  wire width 1 $44

  wire width 1 $45

  wire width 1 $46

  wire width 1 $47

  wire width 1 $48

  wire width 1 $49

  wire width 1 $50

  wire width 1 $51

  wire width 33 $52

  wire width 1 $53

  wire width 1 $54

  wire width 3 $55

  wire width 32 $56

  wire width 1 $57

  wire width 32 $58

  wire width 3 $59

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.N

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.Z

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.C

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$9.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$9.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$9.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags$9.V

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 2 \perm_gt_sig.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 6 \perm_gt_sig.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 17 \perm_gt_sig.index

  attribute \src "/home/runner/workspace/church_machine/core.py:202"
  wire width 7 \perm_gt_sig.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 2 \gt_in.gt_type

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 6 \gt_in.perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 17 \gt_in.index

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 7 \gt_in.version

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 2 \cr_rd_data_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 6 \cr_rd_data_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 17 \cr_rd_data_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:256"
  wire width 7 \cr_rd_data_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 2 \clist_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 6 \clist_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 17 \clist_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/core.py:56"
  wire width 7 \clist_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$61.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 2 \cr_wr_data$61.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 6 \cr_wr_data$61.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 17 \cr_wr_data$61.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 7 \cr_wr_data$61.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$61.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$61.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data$61.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$62.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 2 \cr_wr_data$62.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 6 \cr_wr_data$62.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 17 \cr_wr_data$62.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 7 \cr_wr_data$62.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$62.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$62.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data$62.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$63.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 2 \cr_wr_data$63.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 6 \cr_wr_data$63.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 17 \cr_wr_data$63.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 7 \cr_wr_data$63.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$63.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$63.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data$63.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$64.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 2 \cr_wr_data$64.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 6 \cr_wr_data$64.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 17 \cr_wr_data$64.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 7 \cr_wr_data$64.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$64.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$64.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data$64.word3_seals

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$69.N

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$69.Z

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$69.C

  attribute \src "/home/runner/workspace/church_machine/core.py:71"
  wire width 1 \flags$69.V

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 2 \ns_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 6 \ns_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 17 \ns_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  wire width 7 \ns_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr15_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr15_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr15_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr15_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 2 \thrd_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 6 \thrd_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 17 \thrd_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  wire width 7 \thrd_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr8_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr8_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr8_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr8_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 2 \cr6_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 6 \cr6_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 17 \cr6_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  wire width 7 \cr6_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr6_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr6_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr6_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr6_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 2 \slot3_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 6 \slot3_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 17 \slot3_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  wire width 7 \slot3_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 2 \cr7_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 6 \cr7_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 17 \cr7_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  wire width 7 \cr7_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr7_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr7_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr7_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr7_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr0_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr0_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr0_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr0_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr0_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr0_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr0_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr0_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr0_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr0_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr0_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr0_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr1_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr1_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr1_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr1_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr1_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr1_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr1_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr1_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr1_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr1_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr1_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr1_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr2_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr2_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr2_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr2_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr2_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr2_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr2_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr2_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr2_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr2_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr2_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr2_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr3_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr3_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr3_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr3_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr3_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr3_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr3_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr3_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr3_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr3_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr3_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr3_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr4_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr4_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr4_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr4_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr4_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr4_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr4_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr4_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr4_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr4_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr4_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr4_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr5_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr5_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr5_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr5_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr5_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr5_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr5_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr5_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr5_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr5_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr5_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr5_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr6_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr6_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr6_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr6_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr6_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr6_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr6_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr6_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr7_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr7_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr7_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr7_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr7_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr7_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr7_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr7_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr8_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr8_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr8_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr8_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr8_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr8_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr8_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr8_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr9_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr9_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr9_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr9_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr9_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr9_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr9_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr9_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr9_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr9_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr9_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr9_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr10_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr10_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr10_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr10_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr10_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr10_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr10_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr10_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr10_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr10_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr10_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr10_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr11_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr11_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr11_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr11_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr11_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr11_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr11_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr11_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr11_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr11_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr11_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr11_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr12_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr12_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr12_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr12_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr12_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr12_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr12_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr12_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr12_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr12_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr12_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr12_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr13_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr13_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr13_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr13_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr13_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr13_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr13_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr13_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr13_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr13_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr13_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr13_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr14_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr14_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr14_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr14_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr14_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr14_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr14_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr14_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 2 \boot_cr14_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 6 \boot_cr14_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 17 \boot_cr14_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  wire width 7 \boot_cr14_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr15_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr15_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr15_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr15_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 2 \rt_cr15_wr_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 6 \rt_cr15_wr_gt.perms

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 17 \rt_cr15_wr_gt.index

  attribute \src "/home/runner/workspace/church_machine/core.py:395"
  wire width 7 \rt_cr15_wr_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$178.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 2 \cr_rd_data$178.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 6 \cr_rd_data$178.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 17 \cr_rd_data$178.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 7 \cr_rd_data$178.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$178.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$178.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data$178.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$182.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 2 \cr_rd_data$182.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 6 \cr_rd_data$182.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 17 \cr_rd_data$182.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 7 \cr_rd_data$182.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$182.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$182.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data$182.word3_seals

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$190.word0_gt

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 2 \cr_rd_data$190.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 6 \cr_rd_data$190.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 17 \cr_rd_data$190.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 7 \cr_rd_data$190.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$190.word1_location

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$190.word2_limit

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data$190.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$197.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 2 \cr_rd_data$197.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 6 \cr_rd_data$197.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 17 \cr_rd_data$197.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 7 \cr_rd_data$197.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$197.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$197.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data$197.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$203.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 2 \cr_rd_data$203.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 6 \cr_rd_data$203.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 17 \cr_rd_data$203.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 7 \cr_rd_data$203.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$203.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$203.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data$203.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$205.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 2 \cr15_namespace$205.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 6 \cr15_namespace$205.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 17 \cr15_namespace$205.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 7 \cr15_namespace$205.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$205.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$205.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace$205.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$233.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 2 \cr_rd_data$233.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 6 \cr_rd_data$233.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 17 \cr_rd_data$233.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 7 \cr_rd_data$233.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$233.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$233.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data$233.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$234.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 2 \cr15_namespace$234.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 6 \cr15_namespace$234.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 17 \cr15_namespace$234.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 7 \cr15_namespace$234.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$234.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$234.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace$234.word3_seals

  attribute \src "/home/runner/workspace/church_machine/core.py:93"
  cell \top.core.u_registers \u_registers
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \clear_all \clear_all [0]
    connect \cr_rd_addr \cr_rd_addr [3:0]
    connect \cr_wr_addr \cr_wr_addr [3:0]
    connect \cr_wr_data \cr_wr_data [127:0]
    connect \cr_wr_en \cr_wr_en$65 [0]
    connect \cr0_gt_wr_en \cr0_gt_wr_en [0]
    connect \cr0_gt_wr_data \cr0_gt_wr_data [31:0]
    connect \cr1_gt_wr_en \cr1_gt_wr_en [0]
    connect \cr1_gt_wr_data \cr1_gt_wr_data [31:0]
    connect \cr2_gt_wr_en \cr2_gt_wr_en [0]
    connect \cr2_gt_wr_data \cr2_gt_wr_data [31:0]
    connect \cr3_gt_wr_en \cr3_gt_wr_en [0]
    connect \cr3_gt_wr_data \cr3_gt_wr_data [31:0]
    connect \cr4_gt_wr_en \cr4_gt_wr_en [0]
    connect \cr4_gt_wr_data \cr4_gt_wr_data [31:0]
    connect \cr5_gt_wr_en \cr5_gt_wr_en [0]
    connect \cr5_gt_wr_data \cr5_gt_wr_data [31:0]
    connect \cr6_gt_wr_en \cr6_gt_wr_en [0]
    connect \cr6_gt_wr_data \cr6_gt_wr_data [31:0]
    connect \cr7_gt_wr_en \cr7_gt_wr_en [0]
    connect \cr7_gt_wr_data \cr7_gt_wr_data [31:0]
    connect \cr8_gt_wr_en \cr8_gt_wr_en [0]
    connect \cr8_gt_wr_data \cr8_gt_wr_data [31:0]
    connect \cr9_gt_wr_en \cr9_gt_wr_en [0]
    connect \cr9_gt_wr_data \cr9_gt_wr_data [31:0]
    connect \cr10_gt_wr_en \cr10_gt_wr_en [0]
    connect \cr10_gt_wr_data \cr10_gt_wr_data [31:0]
    connect \cr11_gt_wr_en \cr11_gt_wr_en [0]
    connect \cr11_gt_wr_data \cr11_gt_wr_data [31:0]
    connect \cr12_gt_wr_en \cr12_gt_wr_en [0]
    connect \cr12_gt_wr_data \cr12_gt_wr_data [31:0]
    connect \cr13_gt_wr_en \cr13_gt_wr_en [0]
    connect \cr13_gt_wr_data \cr13_gt_wr_data [31:0]
    connect \cr14_gt_wr_en \cr14_gt_wr_en [0]
    connect \cr14_gt_wr_data \cr14_gt_wr_data [31:0]
    connect \cr15_gt_wr_en \cr15_gt_wr_en [0]
    connect \cr15_gt_wr_data \cr15_gt_wr_data [31:0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \cr15 \cr15_namespace [127:0]
    connect \flags \flags [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:94"
  cell \top.core.u_decoder \u_decoder
    connect \instr_valid \instr_valid [0]
    connect \exec_enable \exec_enable [0]
    connect \is_church_op \is_church_op [0]
    connect \flags \flags [3:0]
    connect \fault_valid \fault_valid [0]
    connect \fault \fault$224 [3:0]
    connect \instruction \instruction [31:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:95"
  cell \top.core.u_perm_check \u_perm_check
    connect \check_valid \check_valid [0]
    connect \check_domain_purity \check_domain_purity [0]
    connect \gt_in \cr_rd_data [31:0]
    connect \required_perms \required_perms [5:0]
    connect \fault_valid \fault_valid$216 [0]
    connect \fault_type \fault_type [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:98"
  cell \top.core.u_lambda \u_lambda
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \lambda_start \lambda_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \lambda_busy \lambda_busy [0]
    connect \lambda_complete \lambda_complete [0]
    connect \cr_rd_addr \cr_rd_addr$29 [3:0]
    connect \nia_set \nia_set [0]
    connect \nia_value \nia_value [31:0]
    connect \lambda_fault \lambda_fault [0]
    connect \fault_type \fault_type$227 [3:0]
    connect \cr_target \instruction [22:19]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:99"
  cell \top.core.u_call \u_call
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \call_start \call_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \mload_src \mload_cr_src [3:0]
    connect \port$874$0 $59 [2:0]
    connect \mload_index \mload_index [16:0]
    connect \call_busy \call_busy [0]
    connect \call_complete \nia_set$301 [0]
    connect \mload_fault \mload_fault [0]
    connect \mload_done \mload_done [0]
    connect \cr_rd_addr \cr_rd_addr$27 [3:0]
    connect \cr_wr_data \cr_wr_data$62 [127:0]
    connect \cr_wr_en \cr_wr_en$54 [0]
    connect \cr_wr_addr \cr_wr_addr$57 [3:0]
    connect \call_fault \call_fault [0]
    connect \fault_type \fault_type$229 [3:0]
    connect \mload_start \mload_start [0]
    connect \mload_fault_type \fault_type$232 [3:0]
    connect \port$1565$0 \instruction [18:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:100"
  cell \top.core.u_return \u_return
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \return_start \ret_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \cr_rd_addr \cr_rd_addr$26 [3:0]
    connect \busy \busy [0]
    connect \reboot_request \reboot_request [0]
    connect \mload_fault \mload_fault [0]
    connect \mload_done \mload_done [0]
    connect \lambda_active \lambda_active [0]
    connect \lambda_pc \lambda_pc [31:0]
    connect \mload_dst \mload_cr_dst$253 [3:0]
    connect \mload_direct_gt \mload_direct_gt$256 [31:0]
    connect \nia_set \nia_set$300 [0]
    connect \nia_value \nia_value$303 [31:0]
    connect \lambda_clear \lambda_clear [0]
    connect \fault_valid \fault_valid$220 [0]
    connect \fault_type \fault_type$230 [3:0]
    connect \mload_start \mload_start$251 [0]
    connect \mload_fault_type \fault_type$232 [3:0]
    connect \cr_src \instruction [17:15]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:101"
  cell \top.core.u_tperm \u_tperm
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \tperm_start \tperm_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \tperm_busy \tperm_busy [0]
    connect \cr_rd_addr \cr_rd_addr$28 [3:0]
    connect \cr_wr_addr \cr_wr_addr$58 [3:0]
    connect \cr_wr_data \cr_wr_data$63 [127:0]
    connect \cr_wr_en \cr_wr_en$53 [0]
    connect \tperm_fault \tperm_fault [0]
    connect \fault_type \fault_type$228 [3:0]
    connect \preset \instruction [3:0]
    connect \cr_target \instruction [22:19]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:102"
  cell \top.core.u_save \u_save
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \save_start \save_start_sig [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \save_busy \save_busy [0]
    connect \port$1202$0 \port$1202$0 [15:0]
    connect \port$1203$0 \port$1203$0 [15:0]
    connect \cr15_namespace \cr15_namespace [127:0]
    connect \cr_rd_addr \cr_rd_addr$25 [3:0]
    connect \save_fault \save_fault [0]
    connect \fault_type \fault_type$231 [3:0]
    connect \mem_rd_addr \mem_rd_addr [31:0]
    connect \mem_rd_en \mem_rd_en$285 [0]
    connect \mem_wr_en \mem_wr_en$284 [0]
    connect \mem_wr_addr \mem_wr_addr [31:0]
    connect \mem_wr_data \mem_wr_data$289 [31:0]
    connect \port$1565$0 \instruction [22:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:103"
  cell \top.core.u_load \u_load
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \load_start \load_start_sig [0]
    connect \mload_m_elevated \mload_m_elevated$264 [0]
    connect \load_busy \load_busy [0]
    connect \load_fault \load_fault [0]
    connect \mload_busy \sub_busy [0]
    connect \mload_fault \mload_fault [0]
    connect \mload_done \mload_done [0]
    connect \mload_start \mload_start$258 [0]
    connect \fault_type \fault_type$232 [3:0]
    connect \port$1565$0 \instruction [22:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:105"
  cell \top.core.u_shared_mload \u_shared_mload
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \cr_rd_data \cr_rd_data [127:0]
    connect \sub_busy \sub_busy [0]
    connect \sub_fault \mload_fault [0]
    connect \sub_done \mload_done [0]
    connect \port$1202$0 \port$1202$0 [15:0]
    connect \port$1203$0 \port$1203$0 [15:0]
    connect \sub_start \sub_start [0]
    connect \sub_cr_src \sub_cr_src [3:0]
    connect \sub_cr_dst \sub_cr_dst [3:0]
    connect \sub_index \sub_index [16:0]
    connect \sub_direct \sub_direct [0]
    connect \sub_direct_gt \sub_direct_gt [31:0]
    connect \sub_m_elevated \sub_m_elevated [0]
    connect \cr15_namespace \cr15_namespace [127:0]
    connect \cr_rd_addr \cr_rd_addr$30 [3:0]
    connect \mem_addr \mem_addr [31:0]
    connect \mem_rd_en \mem_rd_en [0]
    connect \cr_wr_addr \cr_wr_addr$59 [3:0]
    connect \cr_wr_data \cr_wr_data$64 [127:0]
    connect \cr_wr_en \cr_wr_en [0]
    connect \sub_fault_type \fault_type$232 [3:0]
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:123"
  cell $eq $60
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \boot_state [2:0]
    connect \B 3'110
    connect \Y \boot_complete
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:124"
  cell $eq $61
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_state [2:0]
    connect \B 1'1
    connect \Y \clear_all
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:146"
  cell $and $62
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \imem_valid [0]
    connect \B \boot_complete [0]
    connect \Y \instr_valid
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:159"
  cell $and $63
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_complete [0]
    connect \B \exec_enable [0]
    connect \Y \cond_exec_enable
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $64
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_busy [0]
    connect \B \tperm_busy [0]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $65
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \B \call_busy [0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $66
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $2 [0]
    connect \B \busy [0]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $67
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $3 [0]
    connect \B \save_busy [0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:163"
  cell $or $68
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $4 [0]
    connect \B \load_busy [0]
    connect \Y \any_unit_busy
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $and $69
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $eq $70
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 3'111
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $and $71
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $5 [0]
    connect \B $6 [0]
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $not $72
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:176"
  cell $and $73
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $7 [0]
    connect \B $8 [0]
    connect \Y \lambda_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:194"
  cell $or $74
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_start_sig [0]
    connect \B \lambda_busy [0]
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:198"
  cell $mux $75
    parameter \WIDTH 4
    connect \S \save_busy [0]
    connect \A \instruction [18:15]
    connect \B \cr_rd_addr$25 [3:0]
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:197"
  cell $mux $76
    parameter \WIDTH 4
    connect \S \busy [0]
    connect \A $10 [3:0]
    connect \B \cr_rd_addr$26 [3:0]
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:196"
  cell $mux $77
    parameter \WIDTH 4
    connect \S \call_busy [0]
    connect \A $11 [3:0]
    connect \B \cr_rd_addr$27 [3:0]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:195"
  cell $mux $78
    parameter \WIDTH 4
    connect \S \tperm_busy [0]
    connect \A $12 [3:0]
    connect \B \cr_rd_addr$28 [3:0]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:194"
  cell $mux $79
    parameter \WIDTH 4
    connect \S $9 [0]
    connect \A $13 [3:0]
    connect \B \cr_rd_addr$29 [3:0]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:193"
  cell $mux $80
    parameter \WIDTH 4
    connect \S \sub_busy [0]
    connect \A $14 [3:0]
    connect \B \cr_rd_addr$30 [3:0]
    connect \Y \cr_rd_addr
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:208"
  cell $eq $81
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \instruction [18:15]
    connect \B 3'110
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:208"
  cell $mux $82
    parameter \WIDTH 4
    connect \S $15 [0]
    connect \A 4'1000
    connect \B 4'0000
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:229"
  cell $and $83
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y \check_valid
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:231"
  cell $and $84
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:231"
  cell $eq $85
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 3'110
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:231"
  cell $and $86
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $17 [0]
    connect \B $18 [0]
    connect \Y \check_domain_purity
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:299"
  cell $mux $87
    parameter \WIDTH 4
    connect \S 1'0
    connect \A 4'0000
    connect \B 4'0000
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:298"
  cell $mux $88
    parameter \WIDTH 4
    connect \S \cr_wr_en$54 [0]
    connect \A $19 [3:0]
    connect \B \cr_wr_addr$57 [3:0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:297"
  cell $mux $89
    parameter \WIDTH 4
    connect \S \cr_wr_en$53 [0]
    connect \A $20 [3:0]
    connect \B \cr_wr_addr$58 [3:0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:296"
  cell $mux $90
    parameter \WIDTH 4
    connect \S \cr_wr_en [0]
    connect \A $21 [3:0]
    connect \B \cr_wr_addr$59 [3:0]
    connect \Y \cr_wr_addr
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:306"
  cell $mux $91
    parameter \WIDTH 128
    connect \S 1'0
    connect \A 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    connect \B 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:305"
  cell $mux $92
    parameter \WIDTH 128
    connect \S \cr_wr_en$54 [0]
    connect \A $22 [127:0]
    connect \B \cr_wr_data$62 [127:0]
    connect \Y $23
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:304"
  cell $mux $93
    parameter \WIDTH 128
    connect \S \cr_wr_en$53 [0]
    connect \A $23 [127:0]
    connect \B \cr_wr_data$63 [127:0]
    connect \Y $24
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:303"
  cell $mux $94
    parameter \WIDTH 128
    connect \S \cr_wr_en [0]
    connect \A $24 [127:0]
    connect \B \cr_wr_data$64 [127:0]
    connect \Y \cr_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $95
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cr_wr_en [0]
    connect \B \cr_wr_en$53 [0]
    connect \Y $25
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $96
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $25 [0]
    connect \B \cr_wr_en$54 [0]
    connect \Y $26
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $97
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $26 [0]
    connect \B 1'0
    connect \Y $27
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:310"
  cell $or $98
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $27 [0]
    connect \B 1'0
    connect \Y \cr_wr_en$65
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $99
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr0_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $100
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr0_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $101
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr1_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $102
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr1_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $103
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr2_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $104
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr2_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $105
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr3_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $106
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr3_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $107
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr4_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $108
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr4_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $109
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr5_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $110
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr5_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $111
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr6_wr_en [0]
    connect \B 1'0
    connect \Y \cr6_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $112
    parameter \WIDTH 32
    connect \S \boot_cr6_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr6_wr_gt [31:0]
    connect \Y \cr6_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $113
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr7_wr_en [0]
    connect \B 1'0
    connect \Y \cr7_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $114
    parameter \WIDTH 32
    connect \S \boot_cr7_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr7_wr_gt [31:0]
    connect \Y \cr7_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $115
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr8_wr_en [0]
    connect \B 1'0
    connect \Y \cr8_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $116
    parameter \WIDTH 32
    connect \S \boot_cr8_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr8_wr_gt [31:0]
    connect \Y \cr8_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $117
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr9_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $118
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr9_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $119
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr10_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $120
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr10_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $121
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr11_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $122
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr11_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $123
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr12_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $124
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr12_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $125
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr13_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $126
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr13_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $127
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B 1'0
    connect \Y \cr14_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $128
    parameter \WIDTH 32
    connect \S 1'0
    connect \A 32'00000000000000000000000000000000
    connect \B 32'00000000000000000000000000000000
    connect \Y \cr14_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:417"
  cell $or $129
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \boot_cr15_wr_en [0]
    connect \B 1'0
    connect \Y \cr15_gt_wr_en
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:418"
  cell $mux $130
    parameter \WIDTH 32
    connect \S \boot_cr15_wr_en [0]
    connect \A 32'00000000000000000000000000000000
    connect \B \boot_cr15_wr_gt [31:0]
    connect \Y \cr15_gt_wr_data
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $and $131
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $28
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $eq $132
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 2'10
    connect \Y $29
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $and $133
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $28 [0]
    connect \B $29 [0]
    connect \Y $30
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $not $134
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $31
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:422"
  cell $and $135
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $30 [0]
    connect \B $31 [0]
    connect \Y \call_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $and $136
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $32
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $eq $137
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 2'11
    connect \Y $33
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $and $138
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $32 [0]
    connect \B $33 [0]
    connect \Y $34
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $not $139
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $35
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:433"
  cell $and $140
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $34 [0]
    connect \B $35 [0]
    connect \Y \ret_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:454"
  cell $add $141
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A \imem_addr [31:0]
    connect \B 3'100
    connect \Y $36
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $and $142
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $37
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $eq $143
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 3'110
    connect \Y $38
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $and $144
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $37 [0]
    connect \B $38 [0]
    connect \Y $39
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $not $145
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $40
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:458"
  cell $and $146
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $39 [0]
    connect \B $40 [0]
    connect \Y \tperm_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $and $147
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $41
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $eq $148
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 1'1
    connect \Y $42
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $and $149
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $41 [0]
    connect \B $42 [0]
    connect \Y $43
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $not $150
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $44
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:469"
  cell $and $151
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $43 [0]
    connect \B $44 [0]
    connect \Y \save_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $and $152
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B \is_church_op [0]
    connect \Y $45
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $eq $153
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B {  }
    connect \Y $46
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $and $154
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $45 [0]
    connect \B $46 [0]
    connect \Y $47
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $not $155
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $48
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:485"
  cell $and $156
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $47 [0]
    connect \B $48 [0]
    connect \Y \load_start_sig
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:652"
  cell $or $157
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \mem_rd_en [0]
    connect \B 1'0
    connect \Y $49
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:331"
  cell $not $158
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \any_unit_busy [0]
    connect \Y $50
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:331"
  cell $and $159
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \cond_exec_enable [0]
    connect \B $50 [0]
    connect \Y $51
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:332"
  cell $add $160
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A \imem_addr [31:0]
    connect \B 3'100
    connect \Y $52
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:447"
  cell $not $161
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_fault [0]
    connect \Y $53
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:447"
  cell $and $162
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_complete [0]
    connect \B $53 [0]
    connect \Y $54
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:205"
  process $163
    assign \required_perms [5:0] 6'000000
    switch \instruction [31:27]
      case 5'00000
        assign \required_perms [5:0] { 2'00 $16 [3:0] }
      case 5'00001
        assign \required_perms [5:0] 6'010000
      case 5'00010
        assign \required_perms [5:0] 6'100000
      case 5'00101
        assign \required_perms [5:0] 6'001000
      case 5'00100
        assign \required_perms [5:0] 6'001000
      case 5'00111
        assign \required_perms [5:0] 6'000100
      case 5'01000
        assign \required_perms [5:0] 6'000000
      case 5'01001
        assign \required_perms [5:0] 6'000000
      case
        assign \required_perms [5:0] 6'000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:345"
  process $164
    assign \ns_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
        assign \ns_gt [24:8] 17'00000000000000000
        assign \ns_gt [31:25] 7'0000000
        assign \ns_gt [1:0] 2'00
        assign \ns_gt [7:2] 6'000000
      case 3'011
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $165
    assign \boot_cr15_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
        assign \boot_cr15_wr_en [0] 1'1
      case 3'011
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $166
    assign \boot_cr15_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
        assign \boot_cr15_wr_gt [31:0] \ns_gt [31:0]
      case 3'011
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:355"
  process $167
    assign \thrd_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
        assign \thrd_gt [24:8] 17'00000000000000001
        assign \thrd_gt [31:25] 7'0000000
        assign \thrd_gt [1:0] 2'00
        assign \thrd_gt [7:2] 6'000000
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $168
    assign \boot_cr8_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
      case 3'011
        assign \boot_cr8_wr_en [0] 1'1
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $169
    assign \boot_cr8_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
        assign \boot_cr8_wr_gt [31:0] \thrd_gt [31:0]
      case 3'100
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:365"
  process $170
    assign \cr6_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
        assign \cr6_gt [24:8] 17'00000000000000010
        assign \cr6_gt [31:25] 7'0000000
        assign \cr6_gt [1:0] 2'00
        assign \cr6_gt [7:2] 6'100000
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $171
    assign \boot_cr6_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
        assign \boot_cr6_wr_en [0] 1'1
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $172
    assign \boot_cr6_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
        assign \boot_cr6_wr_gt [31:0] \cr6_gt [31:0]
      case 3'101
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:375"
  process $173
    assign \slot3_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \slot3_gt [24:8] 17'00000000000000010
        assign \slot3_gt [31:25] 7'0000000
        assign \slot3_gt [1:0] 2'00
        assign \slot3_gt [7:2] 6'100000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:384"
  process $174
    assign \cr7_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \cr7_gt [24:8] 17'00000000000000011
        assign \cr7_gt [31:25] 7'0000000
        assign \cr7_gt [1:0] 2'00
        assign \cr7_gt [7:2] 6'000100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:340"
  process $175
    assign \boot_cr7_wr_en [0] 1'0
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \boot_cr7_wr_en [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:341"
  process $176
    assign \boot_cr7_wr_gt [31:0] 32'00000000000000000000000000000000
    switch \boot_state [2:0]
      case 3'010
      case 3'011
      case 3'100
      case 3'101
        assign \boot_cr7_wr_gt [31:0] \cr7_gt [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:67"
  process $177
    assign \fault [3:0] 4'0000
    switch { \load_fault [0] \save_fault [0] \fault_valid$220 [0] \call_fault [0] \tperm_fault [0] \lambda_fault [0] \fault_valid$216 [0] \fault_valid [0] }
      case 8'-------1
        assign \fault [3:0] \fault$224 [3:0]
      case 8'------1-
        assign \fault [3:0] \fault_type [3:0]
      case 8'-----1--
        assign \fault [3:0] \fault_type$227 [3:0]
      case 8'----1---
        assign \fault [3:0] \fault_type$228 [3:0]
      case 8'---1----
        assign \fault [3:0] \fault_type$229 [3:0]
      case 8'--1-----
        assign \fault [3:0] \fault_type$230 [3:0]
      case 8'-1------
        assign \fault [3:0] \fault_type$231 [3:0]
      case 8'1-------
        assign \fault [3:0] \fault_type$232 [3:0]
      case
        assign \fault [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:68"
  process $178
    assign \fault_valid$225 [0] 1'0
    switch { \load_fault [0] \save_fault [0] \fault_valid$220 [0] \call_fault [0] \tperm_fault [0] \lambda_fault [0] \fault_valid$216 [0] \fault_valid [0] }
      case 8'-------1
        assign \fault_valid$225 [0] 1'1
      case 8'------1-
        assign \fault_valid$225 [0] 1'1
      case 8'-----1--
        assign \fault_valid$225 [0] 1'1
      case 8'----1---
        assign \fault_valid$225 [0] 1'1
      case 8'---1----
        assign \fault_valid$225 [0] 1'1
      case 8'--1-----
        assign \fault_valid$225 [0] 1'1
      case 8'-1------
        assign \fault_valid$225 [0] 1'1
      case 8'1-------
        assign \fault_valid$225 [0] 1'1
      case
        assign \fault_valid$225 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:12"
  process $179
    assign \sub_start [0] 1'0
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_start [0] \mload_start [0]
      case 3'-1-
        assign \sub_start [0] \mload_start$251 [0]
      case 3'1--
        assign \sub_start [0] \mload_start$258 [0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:13"
  process $180
    assign \sub_cr_src [3:0] 4'0000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_cr_src [3:0] \mload_cr_src [3:0]
      case 3'-1-
        assign \sub_cr_src [3:0] 4'0000
      case 3'1--
        assign \sub_cr_src [3:0] \instruction [18:15]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:14"
  process $181
    assign \sub_cr_dst [3:0] 4'0000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_cr_dst [3:0] { 1'0 $59 [2:0] }
      case 3'-1-
        assign \sub_cr_dst [3:0] \mload_cr_dst$253 [3:0]
      case 3'1--
        assign \sub_cr_dst [3:0] \instruction [22:19]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:15"
  process $182
    assign \sub_index [16:0] 17'00000000000000000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_index [16:0] \mload_index [16:0]
      case 3'-1-
        assign \sub_index [16:0] 17'00000000000000000
      case 3'1--
        assign \sub_index [16:0] { 2'00 \instruction [14:0] }
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:16"
  process $183
    assign \sub_direct [0] 1'0
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_direct [0] 1'0
      case 3'-1-
        assign \sub_direct [0] 1'1
      case 3'1--
        assign \sub_direct [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:17"
  process $184
    assign \sub_direct_gt [31:0] 32'00000000000000000000000000000000
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_direct_gt [31:0] 32'00000000000000000000000000000000
      case 3'-1-
        assign \sub_direct_gt [31:0] \mload_direct_gt$256 [31:0]
      case 3'1--
        assign \sub_direct_gt [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:18"
  process $185
    assign \sub_m_elevated [0] 1'0
    switch { \load_busy [0] \busy [0] \call_busy [0] }
      case 3'--1
        assign \sub_m_elevated [0] 1'1
      case 3'-1-
        assign \sub_m_elevated [0] 1'1
      case 3'1--
        assign \sub_m_elevated [0] \mload_m_elevated$264 [0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:41"
  process $186
    assign \dmem_addr [31:0] 32'00000000000000000000000000000000
    switch { \mem_rd_en$285 [0] \mem_wr_en$284 [0] $49 [0] }
      case 3'--1
        assign \dmem_addr [31:0] \mem_addr [31:0]
      case 3'-1-
        assign \dmem_addr [31:0] \mem_wr_addr [31:0]
      case 3'1--
        assign \dmem_addr [31:0] \mem_rd_addr [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:42"
  process $187
    assign \dmem_rd_en [0] 1'0
    switch { \mem_rd_en$285 [0] \mem_wr_en$284 [0] $49 [0] }
      case 3'--1
        assign \dmem_rd_en [0] \mem_rd_en [0]
      case 3'-1-
      case 3'1--
        assign \dmem_rd_en [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:44"
  process $188
    assign \dmem_wr_data [31:0] 32'00000000000000000000000000000000
    switch { \mem_rd_en$285 [0] \mem_wr_en$284 [0] $49 [0] }
      case 3'--1
        assign \dmem_wr_data [31:0] 32'00000000000000000000000000000000
      case 3'-1-
        assign \dmem_wr_data [31:0] \mem_wr_data$289 [31:0]
      case 3'1--
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:45"
  process $189
    assign \dmem_wr_en [0] 1'0
    switch { \mem_rd_en$285 [0] \mem_wr_en$284 [0] $49 [0] }
      case 3'--1
        assign \dmem_wr_en [0] 1'0
      case 3'-1-
        assign \dmem_wr_en [0] 1'1
      case 3'1--
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:118"
  process $190
    assign $55 [2:0] \boot_state [2:0]
    switch \boot_state [2:0]
      case 3'000
        switch \boot_start [0]
          case 1'1
            assign $55 [2:0] 3'001
        end
      case 3'001
        assign $55 [2:0] 3'010
      case 3'010
        assign $55 [2:0] 3'011
      case 3'011
        assign $55 [2:0] 3'100
      case 3'100
        assign $55 [2:0] 3'101
      case 3'101
        assign $55 [2:0] 3'110
      case 3'110
        assign $55 [2:0] 3'110
    end
    switch { $51 [0] \nia_set$301 [0] \nia_set$300 [0] \nia_set [0] \clear_all [0] \reboot_request [0] }
      case 6'-----1
        assign $55 [2:0] 3'001
      case 6'----1-
      case 6'---1--
      case 6'--1---
      case 6'-1----
      case 6'1-----
    end
    switch \rst [0]
      case 1'1
        assign $55 [2:0] 3'000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:118"
  cell $dff $191
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $55 [2:0]
    connect \CLK \clk [0]
    connect \Q \boot_state
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  process $192
    assign $56 [31:0] \imem_addr [31:0]
    switch { $51 [0] \nia_set$301 [0] \nia_set$300 [0] \nia_set [0] \clear_all [0] \reboot_request [0] }
      case 6'-----1
        assign $56 [31:0] 32'00000000000000000000000000000000
      case 6'----1-
        assign $56 [31:0] 32'00000000000000000000000000000000
      case 6'---1--
        assign $56 [31:0] \nia_value [31:0]
      case 6'--1---
        assign $56 [31:0] \nia_value$303 [31:0]
      case 6'-1----
        assign $56 [31:0] 32'00000000000000000000000000000000
      case 6'1-----
        assign $56 [31:0] $52 [31:0]
    end
    switch \rst [0]
      case 1'1
        assign $56 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:113"
  cell $dff $193
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $56 [31:0]
    connect \CLK \clk [0]
    connect \Q \imem_addr
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:115"
  process $194
    assign $57 [0] \lambda_active [0]
    switch { $54 [0] \lambda_clear [0] \clear_all [0] }
      case 3'--1
        assign $57 [0] 1'0
      case 3'-1-
        assign $57 [0] 1'0
      case 3'1--
        assign $57 [0] 1'1
    end
    switch \rst [0]
      case 1'1
        assign $57 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:115"
  cell $dff $195
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $57 [0]
    connect \CLK \clk [0]
    connect \Q \lambda_active
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:116"
  process $196
    assign $58 [31:0] \lambda_pc [31:0]
    switch { $54 [0] \lambda_clear [0] \clear_all [0] }
      case 3'--1
        assign $58 [31:0] 32'00000000000000000000000000000000
      case 3'-1-
      case 3'1--
        assign $58 [31:0] $36 [31:0]
    end
    switch \rst [0]
      case 1'1
        assign $58 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/core.py:116"
  cell $dff $197
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $58 [31:0]
    connect \CLK \clk [0]
    connect \Q \lambda_pc
  end

connect \boot_state_reg \boot_state [2:0]
connect \imem_data \instruction [31:0]
connect \flags$9 \flags [3:0]
connect \church_op \instruction [31:27]
connect \cr_src \instruction [18:15]
connect \gt_in \cr_rd_data [31:0]
connect \required_perms$35 \required_perms [5:0]
connect \gc_busy 1'0
connect \gc_garbage_count 32'00000000000000000000000000000000
connect \cr_rd_data_gt \cr_rd_data [31:0]
connect \clist_addr 32'00000000000000000000000000000000
connect \clist_rd_en 1'0
connect \clist_wr_data \cr_rd_data [31:0]
connect \clist_wr_en 1'0
connect \flags_in 4'0000
connect \flags_wr_en 1'0
connect \clear_all$47 \clear_all [0]
connect \dr_wr_addr 4'0000
connect \dr_wr_data 32'00000000000000000000000000000000
connect \dr_wr_en 1'0
connect \cr_wr_en$55 1'0
connect \cr_wr_addr$56 4'0000
connect \cr_wr_data$61 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \nia_reg \imem_addr [31:0]
connect \nia \imem_addr [31:0]
connect \flags$69 \flags [3:0]
connect \boot_cr0_wr_en 1'0
connect \rt_cr0_wr_en 1'0
connect \rt_cr0_wr_gt 32'00000000000000000000000000000000
connect \boot_cr0_wr_gt 32'00000000000000000000000000000000
connect \boot_cr1_wr_en 1'0
connect \rt_cr1_wr_en 1'0
connect \rt_cr1_wr_gt 32'00000000000000000000000000000000
connect \boot_cr1_wr_gt 32'00000000000000000000000000000000
connect \boot_cr2_wr_en 1'0
connect \rt_cr2_wr_en 1'0
connect \rt_cr2_wr_gt 32'00000000000000000000000000000000
connect \boot_cr2_wr_gt 32'00000000000000000000000000000000
connect \boot_cr3_wr_en 1'0
connect \rt_cr3_wr_en 1'0
connect \rt_cr3_wr_gt 32'00000000000000000000000000000000
connect \boot_cr3_wr_gt 32'00000000000000000000000000000000
connect \boot_cr4_wr_en 1'0
connect \rt_cr4_wr_en 1'0
connect \rt_cr4_wr_gt 32'00000000000000000000000000000000
connect \boot_cr4_wr_gt 32'00000000000000000000000000000000
connect \boot_cr5_wr_en 1'0
connect \rt_cr5_wr_en 1'0
connect \rt_cr5_wr_gt 32'00000000000000000000000000000000
connect \boot_cr5_wr_gt 32'00000000000000000000000000000000
connect \rt_cr6_wr_en 1'0
connect \rt_cr6_wr_gt 32'00000000000000000000000000000000
connect \rt_cr7_wr_en 1'0
connect \rt_cr7_wr_gt 32'00000000000000000000000000000000
connect \rt_cr8_wr_en 1'0
connect \rt_cr8_wr_gt 32'00000000000000000000000000000000
connect \boot_cr9_wr_en 1'0
connect \rt_cr9_wr_en 1'0
connect \rt_cr9_wr_gt 32'00000000000000000000000000000000
connect \boot_cr9_wr_gt 32'00000000000000000000000000000000
connect \boot_cr10_wr_en 1'0
connect \rt_cr10_wr_en 1'0
connect \rt_cr10_wr_gt 32'00000000000000000000000000000000
connect \boot_cr10_wr_gt 32'00000000000000000000000000000000
connect \boot_cr11_wr_en 1'0
connect \rt_cr11_wr_en 1'0
connect \rt_cr11_wr_gt 32'00000000000000000000000000000000
connect \boot_cr11_wr_gt 32'00000000000000000000000000000000
connect \boot_cr12_wr_en 1'0
connect \rt_cr12_wr_en 1'0
connect \rt_cr12_wr_gt 32'00000000000000000000000000000000
connect \boot_cr12_wr_gt 32'00000000000000000000000000000000
connect \boot_cr13_wr_en 1'0
connect \rt_cr13_wr_en 1'0
connect \rt_cr13_wr_gt 32'00000000000000000000000000000000
connect \boot_cr13_wr_gt 32'00000000000000000000000000000000
connect \boot_cr14_wr_en 1'0
connect \rt_cr14_wr_en 1'0
connect \rt_cr14_wr_gt 32'00000000000000000000000000000000
connect \boot_cr14_wr_gt 32'00000000000000000000000000000000
connect \rt_cr15_wr_en 1'0
connect \rt_cr15_wr_gt 32'00000000000000000000000000000000
connect \call_start \call_start_sig [0]
connect \cr_src$173 \instruction [18:15]
connect \index { 2'00 \instruction [14:0] }
connect \cap_index \instruction [14:0]
connect \mask { 1'0 \instruction [14:0] }
connect \call_mask \instruction [14:0]
connect \cr_rd_data$178 \cr_rd_data [127:0]
connect \return_start \ret_start_sig [0]
connect \cr_src$181 \instruction [17:15]
connect \cr_rd_data$182 \cr_rd_data [127:0]
connect \lambda_active_reg \lambda_active [0]
connect \lambda_pc_reg \lambda_pc [31:0]
connect \lambda_start \lambda_start_sig [0]
connect \cr_target \instruction [22:19]
connect \cr_dst \instruction [22:19]
connect \cr_rd_data$190 \cr_rd_data [127:0]
connect \saved_nia $36 [31:0]
connect \tperm_start \tperm_start_sig [0]
connect \cr_target$194 \instruction [22:19]
connect \preset \instruction [3:0]
connect \tperm_preset \instruction [3:0]
connect \cr_rd_data$197 \cr_rd_data [127:0]
connect \save_start \save_start_sig [0]
connect \cr_src$200 \instruction [18:15]
connect \cr_dst$201 \instruction [22:19]
connect \index$202 { 2'00 \instruction [14:0] }
connect \cr_rd_data$203 \cr_rd_data [127:0]
connect \cr15_namespace$205 \cr15_namespace [127:0]
connect \mem_wr_done 1'1
connect \mem_rd_data { \port$1203$0 [15:0] \port$1202$0 [15:0] }
connect \dmem_rd_data { \port$1203$0 [15:0] \port$1202$0 [15:0] }
connect \mem_rd_valid 1'1
connect \load_start \load_start_sig [0]
connect \cr_src$212 \instruction [18:15]
connect \cr_dst$213 \instruction [22:19]
connect \index$214 { 2'00 \instruction [14:0] }
connect \cr_rd_data$233 \cr_rd_data [127:0]
connect \cr15_namespace$234 \cr15_namespace [127:0]
connect \mem_rd_data$235 { \port$1203$0 [15:0] \port$1202$0 [15:0] }
connect \mem_rd_valid$236 1'1
connect \mload_cr_dst { 1'0 $59 [2:0] }
connect \mload_direct 1'0
connect \mload_direct_gt 32'00000000000000000000000000000000
connect \mload_m_elevated 1'1
connect \mload_cr_src$252 4'0000
connect \mload_index$254 17'00000000000000000
connect \mload_direct$255 1'1
connect \mload_m_elevated$257 1'1
connect \mload_cr_src$259 \instruction [18:15]
connect \mload_cr_dst$260 \instruction [22:19]
connect \mload_index$261 { 2'00 \instruction [14:0] }
connect \mload_direct$262 1'0
connect \mload_direct_gt$263 32'00000000000000000000000000000000
connect \sub_done \mload_done [0]
connect \sub_fault \mload_fault [0]
connect \mload_fault_type \fault_type$232 [3:0]
connect \sub_fault_type \fault_type$232 [3:0]
connect \mload_done$271 \mload_done [0]
connect \mload_fault$272 \mload_fault [0]
connect \mload_fault_type$273 \fault_type$232 [3:0]
connect \mload_busy \sub_busy [0]
connect \mload_done$275 \mload_done [0]
connect \mload_fault$276 \mload_fault [0]
connect \mload_fault_type$277 \fault_type$232 [3:0]
connect \mem_wr_en 1'0
connect \mem_wr_data 32'00000000000000000000000000000000
connect \ns_addr 32'00000000000000000000000000000000
connect \ns_rd_en 1'0
connect \ns_wr_data 96'000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \ns_wr_en 1'0
connect \nia_value$304 32'00000000000000000000000000000000
connect \perm_gt_sig \cr_rd_data [31:0]
connect \flags.N \flags [0]
connect \flags.Z \flags [1]
connect \flags.C \flags [2]
connect \flags.V \flags [3]
connect \flags$9.N \flags [0]
connect \flags$9.Z \flags [1]
connect \flags$9.C \flags [2]
connect \flags$9.V \flags [3]
connect \perm_gt_sig.gt_type \cr_rd_data [1:0]
connect \perm_gt_sig.perms \cr_rd_data [7:2]
connect \perm_gt_sig.index \cr_rd_data [24:8]
connect \perm_gt_sig.version \cr_rd_data [31:25]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]
connect \gt_in.gt_type \cr_rd_data [1:0]
connect \gt_in.perms \cr_rd_data [7:2]
connect \gt_in.index \cr_rd_data [24:8]
connect \gt_in.version \cr_rd_data [31:25]
connect \cr_rd_data_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data_gt.index \cr_rd_data [24:8]
connect \cr_rd_data_gt.version \cr_rd_data [31:25]
connect \clist_wr_data.gt_type \cr_rd_data [1:0]
connect \clist_wr_data.perms \cr_rd_data [7:2]
connect \clist_wr_data.index \cr_rd_data [24:8]
connect \clist_wr_data.version \cr_rd_data [31:25]
connect \flags_in.N 1'0
connect \flags_in.Z 1'0
connect \flags_in.C 1'0
connect \flags_in.V 1'0
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr_wr_data$61.word0_gt 32'00000000000000000000000000000000
connect \cr_wr_data$61.word0_gt.gt_type 2'00
connect \cr_wr_data$61.word0_gt.perms 6'000000
connect \cr_wr_data$61.word0_gt.index 17'00000000000000000
connect \cr_wr_data$61.word0_gt.version 7'0000000
connect \cr_wr_data$61.word1_location 32'00000000000000000000000000000000
connect \cr_wr_data$61.word2_limit 32'00000000000000000000000000000000
connect \cr_wr_data$61.word3_seals 32'00000000000000000000000000000000
connect \cr_wr_data$62.word0_gt \cr_wr_data$62 [31:0]
connect \cr_wr_data$62.word0_gt.gt_type \cr_wr_data$62 [1:0]
connect \cr_wr_data$62.word0_gt.perms \cr_wr_data$62 [7:2]
connect \cr_wr_data$62.word0_gt.index \cr_wr_data$62 [24:8]
connect \cr_wr_data$62.word0_gt.version \cr_wr_data$62 [31:25]
connect \cr_wr_data$62.word1_location \cr_wr_data$62 [63:32]
connect \cr_wr_data$62.word2_limit \cr_wr_data$62 [95:64]
connect \cr_wr_data$62.word3_seals \cr_wr_data$62 [127:96]
connect \cr_wr_data$63.word0_gt \cr_wr_data$63 [31:0]
connect \cr_wr_data$63.word0_gt.gt_type \cr_wr_data$63 [1:0]
connect \cr_wr_data$63.word0_gt.perms \cr_wr_data$63 [7:2]
connect \cr_wr_data$63.word0_gt.index \cr_wr_data$63 [24:8]
connect \cr_wr_data$63.word0_gt.version \cr_wr_data$63 [31:25]
connect \cr_wr_data$63.word1_location \cr_wr_data$63 [63:32]
connect \cr_wr_data$63.word2_limit \cr_wr_data$63 [95:64]
connect \cr_wr_data$63.word3_seals \cr_wr_data$63 [127:96]
connect \cr_wr_data$64.word0_gt \cr_wr_data$64 [31:0]
connect \cr_wr_data$64.word0_gt.gt_type \cr_wr_data$64 [1:0]
connect \cr_wr_data$64.word0_gt.perms \cr_wr_data$64 [7:2]
connect \cr_wr_data$64.word0_gt.index \cr_wr_data$64 [24:8]
connect \cr_wr_data$64.word0_gt.version \cr_wr_data$64 [31:25]
connect \cr_wr_data$64.word1_location \cr_wr_data$64 [63:32]
connect \cr_wr_data$64.word2_limit \cr_wr_data$64 [95:64]
connect \cr_wr_data$64.word3_seals \cr_wr_data$64 [127:96]
connect \flags$69.N \flags [0]
connect \flags$69.Z \flags [1]
connect \flags$69.C \flags [2]
connect \flags$69.V \flags [3]
connect \ns_gt.gt_type \ns_gt [1:0]
connect \ns_gt.perms \ns_gt [7:2]
connect \ns_gt.index \ns_gt [24:8]
connect \ns_gt.version \ns_gt [31:25]
connect \boot_cr15_wr_gt.gt_type \boot_cr15_wr_gt [1:0]
connect \boot_cr15_wr_gt.perms \boot_cr15_wr_gt [7:2]
connect \boot_cr15_wr_gt.index \boot_cr15_wr_gt [24:8]
connect \boot_cr15_wr_gt.version \boot_cr15_wr_gt [31:25]
connect \thrd_gt.gt_type \thrd_gt [1:0]
connect \thrd_gt.perms \thrd_gt [7:2]
connect \thrd_gt.index \thrd_gt [24:8]
connect \thrd_gt.version \thrd_gt [31:25]
connect \boot_cr8_wr_gt.gt_type \boot_cr8_wr_gt [1:0]
connect \boot_cr8_wr_gt.perms \boot_cr8_wr_gt [7:2]
connect \boot_cr8_wr_gt.index \boot_cr8_wr_gt [24:8]
connect \boot_cr8_wr_gt.version \boot_cr8_wr_gt [31:25]
connect \cr6_gt.gt_type \cr6_gt [1:0]
connect \cr6_gt.perms \cr6_gt [7:2]
connect \cr6_gt.index \cr6_gt [24:8]
connect \cr6_gt.version \cr6_gt [31:25]
connect \boot_cr6_wr_gt.gt_type \boot_cr6_wr_gt [1:0]
connect \boot_cr6_wr_gt.perms \boot_cr6_wr_gt [7:2]
connect \boot_cr6_wr_gt.index \boot_cr6_wr_gt [24:8]
connect \boot_cr6_wr_gt.version \boot_cr6_wr_gt [31:25]
connect \slot3_gt.gt_type \slot3_gt [1:0]
connect \slot3_gt.perms \slot3_gt [7:2]
connect \slot3_gt.index \slot3_gt [24:8]
connect \slot3_gt.version \slot3_gt [31:25]
connect \cr7_gt.gt_type \cr7_gt [1:0]
connect \cr7_gt.perms \cr7_gt [7:2]
connect \cr7_gt.index \cr7_gt [24:8]
connect \cr7_gt.version \cr7_gt [31:25]
connect \boot_cr7_wr_gt.gt_type \boot_cr7_wr_gt [1:0]
connect \boot_cr7_wr_gt.perms \boot_cr7_wr_gt [7:2]
connect \boot_cr7_wr_gt.index \boot_cr7_wr_gt [24:8]
connect \boot_cr7_wr_gt.version \boot_cr7_wr_gt [31:25]
connect \cr0_gt_wr_data.gt_type \cr0_gt_wr_data [1:0]
connect \cr0_gt_wr_data.perms \cr0_gt_wr_data [7:2]
connect \cr0_gt_wr_data.index \cr0_gt_wr_data [24:8]
connect \cr0_gt_wr_data.version \cr0_gt_wr_data [31:25]
connect \rt_cr0_wr_gt.gt_type 2'00
connect \rt_cr0_wr_gt.perms 6'000000
connect \rt_cr0_wr_gt.index 17'00000000000000000
connect \rt_cr0_wr_gt.version 7'0000000
connect \boot_cr0_wr_gt.gt_type 2'00
connect \boot_cr0_wr_gt.perms 6'000000
connect \boot_cr0_wr_gt.index 17'00000000000000000
connect \boot_cr0_wr_gt.version 7'0000000
connect \cr1_gt_wr_data.gt_type \cr1_gt_wr_data [1:0]
connect \cr1_gt_wr_data.perms \cr1_gt_wr_data [7:2]
connect \cr1_gt_wr_data.index \cr1_gt_wr_data [24:8]
connect \cr1_gt_wr_data.version \cr1_gt_wr_data [31:25]
connect \rt_cr1_wr_gt.gt_type 2'00
connect \rt_cr1_wr_gt.perms 6'000000
connect \rt_cr1_wr_gt.index 17'00000000000000000
connect \rt_cr1_wr_gt.version 7'0000000
connect \boot_cr1_wr_gt.gt_type 2'00
connect \boot_cr1_wr_gt.perms 6'000000
connect \boot_cr1_wr_gt.index 17'00000000000000000
connect \boot_cr1_wr_gt.version 7'0000000
connect \cr2_gt_wr_data.gt_type \cr2_gt_wr_data [1:0]
connect \cr2_gt_wr_data.perms \cr2_gt_wr_data [7:2]
connect \cr2_gt_wr_data.index \cr2_gt_wr_data [24:8]
connect \cr2_gt_wr_data.version \cr2_gt_wr_data [31:25]
connect \rt_cr2_wr_gt.gt_type 2'00
connect \rt_cr2_wr_gt.perms 6'000000
connect \rt_cr2_wr_gt.index 17'00000000000000000
connect \rt_cr2_wr_gt.version 7'0000000
connect \boot_cr2_wr_gt.gt_type 2'00
connect \boot_cr2_wr_gt.perms 6'000000
connect \boot_cr2_wr_gt.index 17'00000000000000000
connect \boot_cr2_wr_gt.version 7'0000000
connect \cr3_gt_wr_data.gt_type \cr3_gt_wr_data [1:0]
connect \cr3_gt_wr_data.perms \cr3_gt_wr_data [7:2]
connect \cr3_gt_wr_data.index \cr3_gt_wr_data [24:8]
connect \cr3_gt_wr_data.version \cr3_gt_wr_data [31:25]
connect \rt_cr3_wr_gt.gt_type 2'00
connect \rt_cr3_wr_gt.perms 6'000000
connect \rt_cr3_wr_gt.index 17'00000000000000000
connect \rt_cr3_wr_gt.version 7'0000000
connect \boot_cr3_wr_gt.gt_type 2'00
connect \boot_cr3_wr_gt.perms 6'000000
connect \boot_cr3_wr_gt.index 17'00000000000000000
connect \boot_cr3_wr_gt.version 7'0000000
connect \cr4_gt_wr_data.gt_type \cr4_gt_wr_data [1:0]
connect \cr4_gt_wr_data.perms \cr4_gt_wr_data [7:2]
connect \cr4_gt_wr_data.index \cr4_gt_wr_data [24:8]
connect \cr4_gt_wr_data.version \cr4_gt_wr_data [31:25]
connect \rt_cr4_wr_gt.gt_type 2'00
connect \rt_cr4_wr_gt.perms 6'000000
connect \rt_cr4_wr_gt.index 17'00000000000000000
connect \rt_cr4_wr_gt.version 7'0000000
connect \boot_cr4_wr_gt.gt_type 2'00
connect \boot_cr4_wr_gt.perms 6'000000
connect \boot_cr4_wr_gt.index 17'00000000000000000
connect \boot_cr4_wr_gt.version 7'0000000
connect \cr5_gt_wr_data.gt_type \cr5_gt_wr_data [1:0]
connect \cr5_gt_wr_data.perms \cr5_gt_wr_data [7:2]
connect \cr5_gt_wr_data.index \cr5_gt_wr_data [24:8]
connect \cr5_gt_wr_data.version \cr5_gt_wr_data [31:25]
connect \rt_cr5_wr_gt.gt_type 2'00
connect \rt_cr5_wr_gt.perms 6'000000
connect \rt_cr5_wr_gt.index 17'00000000000000000
connect \rt_cr5_wr_gt.version 7'0000000
connect \boot_cr5_wr_gt.gt_type 2'00
connect \boot_cr5_wr_gt.perms 6'000000
connect \boot_cr5_wr_gt.index 17'00000000000000000
connect \boot_cr5_wr_gt.version 7'0000000
connect \cr6_gt_wr_data.gt_type \cr6_gt_wr_data [1:0]
connect \cr6_gt_wr_data.perms \cr6_gt_wr_data [7:2]
connect \cr6_gt_wr_data.index \cr6_gt_wr_data [24:8]
connect \cr6_gt_wr_data.version \cr6_gt_wr_data [31:25]
connect \rt_cr6_wr_gt.gt_type 2'00
connect \rt_cr6_wr_gt.perms 6'000000
connect \rt_cr6_wr_gt.index 17'00000000000000000
connect \rt_cr6_wr_gt.version 7'0000000
connect \cr7_gt_wr_data.gt_type \cr7_gt_wr_data [1:0]
connect \cr7_gt_wr_data.perms \cr7_gt_wr_data [7:2]
connect \cr7_gt_wr_data.index \cr7_gt_wr_data [24:8]
connect \cr7_gt_wr_data.version \cr7_gt_wr_data [31:25]
connect \rt_cr7_wr_gt.gt_type 2'00
connect \rt_cr7_wr_gt.perms 6'000000
connect \rt_cr7_wr_gt.index 17'00000000000000000
connect \rt_cr7_wr_gt.version 7'0000000
connect \cr8_gt_wr_data.gt_type \cr8_gt_wr_data [1:0]
connect \cr8_gt_wr_data.perms \cr8_gt_wr_data [7:2]
connect \cr8_gt_wr_data.index \cr8_gt_wr_data [24:8]
connect \cr8_gt_wr_data.version \cr8_gt_wr_data [31:25]
connect \rt_cr8_wr_gt.gt_type 2'00
connect \rt_cr8_wr_gt.perms 6'000000
connect \rt_cr8_wr_gt.index 17'00000000000000000
connect \rt_cr8_wr_gt.version 7'0000000
connect \cr9_gt_wr_data.gt_type \cr9_gt_wr_data [1:0]
connect \cr9_gt_wr_data.perms \cr9_gt_wr_data [7:2]
connect \cr9_gt_wr_data.index \cr9_gt_wr_data [24:8]
connect \cr9_gt_wr_data.version \cr9_gt_wr_data [31:25]
connect \rt_cr9_wr_gt.gt_type 2'00
connect \rt_cr9_wr_gt.perms 6'000000
connect \rt_cr9_wr_gt.index 17'00000000000000000
connect \rt_cr9_wr_gt.version 7'0000000
connect \boot_cr9_wr_gt.gt_type 2'00
connect \boot_cr9_wr_gt.perms 6'000000
connect \boot_cr9_wr_gt.index 17'00000000000000000
connect \boot_cr9_wr_gt.version 7'0000000
connect \cr10_gt_wr_data.gt_type \cr10_gt_wr_data [1:0]
connect \cr10_gt_wr_data.perms \cr10_gt_wr_data [7:2]
connect \cr10_gt_wr_data.index \cr10_gt_wr_data [24:8]
connect \cr10_gt_wr_data.version \cr10_gt_wr_data [31:25]
connect \rt_cr10_wr_gt.gt_type 2'00
connect \rt_cr10_wr_gt.perms 6'000000
connect \rt_cr10_wr_gt.index 17'00000000000000000
connect \rt_cr10_wr_gt.version 7'0000000
connect \boot_cr10_wr_gt.gt_type 2'00
connect \boot_cr10_wr_gt.perms 6'000000
connect \boot_cr10_wr_gt.index 17'00000000000000000
connect \boot_cr10_wr_gt.version 7'0000000
connect \cr11_gt_wr_data.gt_type \cr11_gt_wr_data [1:0]
connect \cr11_gt_wr_data.perms \cr11_gt_wr_data [7:2]
connect \cr11_gt_wr_data.index \cr11_gt_wr_data [24:8]
connect \cr11_gt_wr_data.version \cr11_gt_wr_data [31:25]
connect \rt_cr11_wr_gt.gt_type 2'00
connect \rt_cr11_wr_gt.perms 6'000000
connect \rt_cr11_wr_gt.index 17'00000000000000000
connect \rt_cr11_wr_gt.version 7'0000000
connect \boot_cr11_wr_gt.gt_type 2'00
connect \boot_cr11_wr_gt.perms 6'000000
connect \boot_cr11_wr_gt.index 17'00000000000000000
connect \boot_cr11_wr_gt.version 7'0000000
connect \cr12_gt_wr_data.gt_type \cr12_gt_wr_data [1:0]
connect \cr12_gt_wr_data.perms \cr12_gt_wr_data [7:2]
connect \cr12_gt_wr_data.index \cr12_gt_wr_data [24:8]
connect \cr12_gt_wr_data.version \cr12_gt_wr_data [31:25]
connect \rt_cr12_wr_gt.gt_type 2'00
connect \rt_cr12_wr_gt.perms 6'000000
connect \rt_cr12_wr_gt.index 17'00000000000000000
connect \rt_cr12_wr_gt.version 7'0000000
connect \boot_cr12_wr_gt.gt_type 2'00
connect \boot_cr12_wr_gt.perms 6'000000
connect \boot_cr12_wr_gt.index 17'00000000000000000
connect \boot_cr12_wr_gt.version 7'0000000
connect \cr13_gt_wr_data.gt_type \cr13_gt_wr_data [1:0]
connect \cr13_gt_wr_data.perms \cr13_gt_wr_data [7:2]
connect \cr13_gt_wr_data.index \cr13_gt_wr_data [24:8]
connect \cr13_gt_wr_data.version \cr13_gt_wr_data [31:25]
connect \rt_cr13_wr_gt.gt_type 2'00
connect \rt_cr13_wr_gt.perms 6'000000
connect \rt_cr13_wr_gt.index 17'00000000000000000
connect \rt_cr13_wr_gt.version 7'0000000
connect \boot_cr13_wr_gt.gt_type 2'00
connect \boot_cr13_wr_gt.perms 6'000000
connect \boot_cr13_wr_gt.index 17'00000000000000000
connect \boot_cr13_wr_gt.version 7'0000000
connect \cr14_gt_wr_data.gt_type \cr14_gt_wr_data [1:0]
connect \cr14_gt_wr_data.perms \cr14_gt_wr_data [7:2]
connect \cr14_gt_wr_data.index \cr14_gt_wr_data [24:8]
connect \cr14_gt_wr_data.version \cr14_gt_wr_data [31:25]
connect \rt_cr14_wr_gt.gt_type 2'00
connect \rt_cr14_wr_gt.perms 6'000000
connect \rt_cr14_wr_gt.index 17'00000000000000000
connect \rt_cr14_wr_gt.version 7'0000000
connect \boot_cr14_wr_gt.gt_type 2'00
connect \boot_cr14_wr_gt.perms 6'000000
connect \boot_cr14_wr_gt.index 17'00000000000000000
connect \boot_cr14_wr_gt.version 7'0000000
connect \cr15_gt_wr_data.gt_type \cr15_gt_wr_data [1:0]
connect \cr15_gt_wr_data.perms \cr15_gt_wr_data [7:2]
connect \cr15_gt_wr_data.index \cr15_gt_wr_data [24:8]
connect \cr15_gt_wr_data.version \cr15_gt_wr_data [31:25]
connect \rt_cr15_wr_gt.gt_type 2'00
connect \rt_cr15_wr_gt.perms 6'000000
connect \rt_cr15_wr_gt.index 17'00000000000000000
connect \rt_cr15_wr_gt.version 7'0000000
connect \cr_rd_data$178.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$178.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$178.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$178.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$178.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$178.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$178.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$178.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$182.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$182.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$182.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$182.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$182.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$182.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$182.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$182.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$190.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$190.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$190.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$190.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$190.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$190.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$190.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$190.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$197.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$197.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$197.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$197.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$197.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$197.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$197.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$197.word3_seals \cr_rd_data [127:96]
connect \cr_rd_data$203.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$203.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$203.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$203.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$203.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$203.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$203.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$203.word3_seals \cr_rd_data [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \cr15_namespace$205.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace$205.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace$205.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace$205.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace$205.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace$205.word1_location \cr15_namespace [63:32]
connect \cr15_namespace$205.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace$205.word3_seals \cr15_namespace [127:96]
connect \cr_rd_data$233.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data$233.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data$233.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data$233.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data$233.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data$233.word1_location \cr_rd_data [63:32]
connect \cr_rd_data$233.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data$233.word3_seals \cr_rd_data [127:96]
connect \cr15_namespace$234.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace$234.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace$234.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace$234.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace$234.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace$234.word1_location \cr15_namespace [63:32]
connect \cr15_namespace$234.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace$234.word3_seals \cr15_namespace [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/registers.py:59"
module \top.core.u_registers

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr0

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr1

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr2

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr3

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr4

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr5

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr6

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr7

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr8

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr9

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr10

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr11

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr12

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr13

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr14

  attribute \src "/home/runner/workspace/church_machine/registers.py:33"
  wire width 2 \cr_word_rd_sel

  attribute \src "/home/runner/workspace/church_machine/registers.py:34"
  wire width 32 \cr_word_rd_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:32"
  wire width 4 \cr_word_rd_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr6_clist

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr14_cloomc

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr8_thread

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/registers.py:45"
  wire width 32 \dr_rd_data1

  attribute \src "/home/runner/workspace/church_machine/registers.py:44"
  wire width 4 \dr_rd_addr1

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr0

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr1

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr2

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \dr3

  attribute \src "/home/runner/workspace/church_machine/registers.py:47"
  wire width 32 \dr_rd_data2

  attribute \src "/home/runner/workspace/church_machine/registers.py:46"
  wire width 4 \dr_rd_addr2

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  attribute \init 4'0000
  wire width 4 \flags_reg

  attribute \src "/home/runner/workspace/church_machine/registers.py:30"
  wire width 1 \cr_word_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:28"
  wire width 2 \cr_word_sel

  attribute \src "/home/runner/workspace/church_machine/registers.py:27"
  wire width 4 \cr_word_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:29"
  wire width 32 \cr_word_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:50"
  wire width 1 \dr_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:48"
  wire width 4 \dr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:49"
  wire width 32 \dr_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:54"
  wire width 1 \flags_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 4 \flags_in

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/registers.py:56"
  wire width 1 input 2  \clear_all

  attribute \src "/home/runner/workspace/church_machine/registers.py:20"
  wire width 4 input 3  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:23"
  wire width 4 input 4  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 128 input 5  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:25"
  wire width 1 input 6  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 7  \cr0_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 8  \cr0_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 9  \cr1_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 10  \cr1_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 11  \cr2_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 12  \cr2_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 13  \cr3_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 14  \cr3_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 15  \cr4_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 16  \cr4_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 17  \cr5_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 18  \cr5_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 19  \cr6_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 20  \cr6_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 21  \cr7_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 22  \cr7_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 23  \cr8_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 24  \cr8_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 25  \cr9_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 26  \cr9_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 27  \cr10_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 28  \cr10_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 29  \cr11_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 30  \cr11_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 31  \cr12_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 32  \cr12_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 33  \cr13_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 34  \cr13_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 35  \cr14_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 36  \cr14_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:42"
  wire width 1 input 37  \cr15_gt_wr_en

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 32 input 38  \cr15_gt_wr_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 128 output 39  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 output 40  \cr15

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  attribute \init 4'0000
  wire width 4 output 41  \flags

  wire width 128 $1

  wire width 128 $2

  wire width 128 $3

  wire width 128 $4

  wire width 1 $5

  wire width 32 $6

  wire width 1 $7

  wire width 32 $8

  wire width 1 $9

  wire width 1 $10

  wire width 128 $11

  wire width 128 $12

  wire width 128 $13

  wire width 128 $14

  wire width 128 $15

  wire width 128 $16

  wire width 128 $17

  wire width 128 $18

  wire width 128 $19

  wire width 128 $20

  wire width 128 $21

  wire width 128 $22

  wire width 128 $23

  wire width 128 $24

  wire width 128 $25

  wire width 128 $26

  wire width 32 $27

  wire width 32 $28

  wire width 32 $29

  wire width 32 $30

  wire width 4 $31

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:21"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr0.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr0.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr0.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr0.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr0.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr1.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr1.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr1.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr1.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr1.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr2.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr2.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr2.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr2.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr2.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr3.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr3.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr3.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr3.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr3.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr4.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr4.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr4.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr4.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr4.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr5.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr5.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr5.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr5.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr5.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr6.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr6.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr6.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr6.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr6.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr7.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr7.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr7.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr7.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr7.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr8.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr8.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr8.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr8.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr8.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr9.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr9.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr9.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr9.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr9.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr10.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr10.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr10.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr10.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr10.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr11.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr11.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr11.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr11.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr11.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr12.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr12.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr12.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr12.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr12.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr13.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr13.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr13.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr13.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr13.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr14.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr14.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr14.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr14.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr14.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 2 \cr15.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 6 \cr15.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 17 \cr15.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 7 \cr15.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  wire width 32 \cr15.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 2 \cr6_clist.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 6 \cr6_clist.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 17 \cr6_clist.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 7 \cr6_clist.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:36"
  wire width 32 \cr6_clist.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 2 \cr14_cloomc.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 6 \cr14_cloomc.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 17 \cr14_cloomc.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 7 \cr14_cloomc.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:37"
  wire width 32 \cr14_cloomc.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 2 \cr8_thread.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 6 \cr8_thread.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 17 \cr8_thread.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 7 \cr8_thread.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:38"
  wire width 32 \cr8_thread.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:39"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:52"
  wire width 1 \flags.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  wire width 1 \flags_reg.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/registers.py:24"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr0_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr0_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr0_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr0_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr1_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr1_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr1_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr1_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr2_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr2_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr2_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr2_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr3_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr3_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr3_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr3_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr4_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr4_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr4_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr4_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr5_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr5_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr5_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr5_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr6_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr6_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr6_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr6_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr7_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr7_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr7_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr7_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr8_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr8_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr8_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr8_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr9_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr9_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr9_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr9_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr10_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr10_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr10_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr10_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr11_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr11_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr11_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr11_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr12_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr12_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr12_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr12_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr13_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr13_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr13_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr13_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr14_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr14_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr14_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr14_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 2 \cr15_gt_wr_data.gt_type

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 6 \cr15_gt_wr_data.perms

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 17 \cr15_gt_wr_data.index

  attribute \src "/home/runner/workspace/church_machine/registers.py:41"
  wire width 7 \cr15_gt_wr_data.version

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.N

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.Z

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.C

  attribute \src "/home/runner/workspace/church_machine/registers.py:53"
  wire width 1 \flags_in.V

  attribute \src "/home/runner/workspace/church_machine/registers.py:65"
  process $32
    assign \cr_rd_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \cr_rd_addr [3:0]
      case 4'0000
        assign \cr_rd_data [127:0] \cr0 [127:0]
      case 4'0001
        assign \cr_rd_data [127:0] \cr1 [127:0]
      case 4'0010
        assign \cr_rd_data [127:0] \cr2 [127:0]
      case 4'0011
        assign \cr_rd_data [127:0] \cr3 [127:0]
      case 4'0100
        assign \cr_rd_data [127:0] \cr4 [127:0]
      case 4'0101
        assign \cr_rd_data [127:0] \cr5 [127:0]
      case 4'0110
        assign \cr_rd_data [127:0] \cr6 [127:0]
      case 4'0111
        assign \cr_rd_data [127:0] \cr7 [127:0]
      case 4'1000
        assign \cr_rd_data [127:0] \cr8 [127:0]
      case 4'1001
        assign \cr_rd_data [127:0] \cr9 [127:0]
      case 4'1010
        assign \cr_rd_data [127:0] \cr10 [127:0]
      case 4'1011
        assign \cr_rd_data [127:0] \cr11 [127:0]
      case 4'1100
        assign \cr_rd_data [127:0] \cr12 [127:0]
      case 4'1101
        assign \cr_rd_data [127:0] \cr13 [127:0]
      case 4'1110
        assign \cr_rd_data [127:0] \cr14 [127:0]
      case 4'1111
        assign \cr_rd_data [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:69"
  process $33
    assign $1 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $1 [127:0] \cr0 [127:0]
      case 4'0001
        assign $1 [127:0] \cr1 [127:0]
      case 4'0010
        assign $1 [127:0] \cr2 [127:0]
      case 4'0011
        assign $1 [127:0] \cr3 [127:0]
      case 4'0100
        assign $1 [127:0] \cr4 [127:0]
      case 4'0101
        assign $1 [127:0] \cr5 [127:0]
      case 4'0110
        assign $1 [127:0] \cr6 [127:0]
      case 4'0111
        assign $1 [127:0] \cr7 [127:0]
      case 4'1000
        assign $1 [127:0] \cr8 [127:0]
      case 4'1001
        assign $1 [127:0] \cr9 [127:0]
      case 4'1010
        assign $1 [127:0] \cr10 [127:0]
      case 4'1011
        assign $1 [127:0] \cr11 [127:0]
      case 4'1100
        assign $1 [127:0] \cr12 [127:0]
      case 4'1101
        assign $1 [127:0] \cr13 [127:0]
      case 4'1110
        assign $1 [127:0] \cr14 [127:0]
      case 4'1111
        assign $1 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:71"
  process $34
    assign $2 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $2 [127:0] \cr0 [127:0]
      case 4'0001
        assign $2 [127:0] \cr1 [127:0]
      case 4'0010
        assign $2 [127:0] \cr2 [127:0]
      case 4'0011
        assign $2 [127:0] \cr3 [127:0]
      case 4'0100
        assign $2 [127:0] \cr4 [127:0]
      case 4'0101
        assign $2 [127:0] \cr5 [127:0]
      case 4'0110
        assign $2 [127:0] \cr6 [127:0]
      case 4'0111
        assign $2 [127:0] \cr7 [127:0]
      case 4'1000
        assign $2 [127:0] \cr8 [127:0]
      case 4'1001
        assign $2 [127:0] \cr9 [127:0]
      case 4'1010
        assign $2 [127:0] \cr10 [127:0]
      case 4'1011
        assign $2 [127:0] \cr11 [127:0]
      case 4'1100
        assign $2 [127:0] \cr12 [127:0]
      case 4'1101
        assign $2 [127:0] \cr13 [127:0]
      case 4'1110
        assign $2 [127:0] \cr14 [127:0]
      case 4'1111
        assign $2 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:73"
  process $35
    assign $3 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $3 [127:0] \cr0 [127:0]
      case 4'0001
        assign $3 [127:0] \cr1 [127:0]
      case 4'0010
        assign $3 [127:0] \cr2 [127:0]
      case 4'0011
        assign $3 [127:0] \cr3 [127:0]
      case 4'0100
        assign $3 [127:0] \cr4 [127:0]
      case 4'0101
        assign $3 [127:0] \cr5 [127:0]
      case 4'0110
        assign $3 [127:0] \cr6 [127:0]
      case 4'0111
        assign $3 [127:0] \cr7 [127:0]
      case 4'1000
        assign $3 [127:0] \cr8 [127:0]
      case 4'1001
        assign $3 [127:0] \cr9 [127:0]
      case 4'1010
        assign $3 [127:0] \cr10 [127:0]
      case 4'1011
        assign $3 [127:0] \cr11 [127:0]
      case 4'1100
        assign $3 [127:0] \cr12 [127:0]
      case 4'1101
        assign $3 [127:0] \cr13 [127:0]
      case 4'1110
        assign $3 [127:0] \cr14 [127:0]
      case 4'1111
        assign $3 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:75"
  process $36
    assign $4 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $4 [127:0] \cr0 [127:0]
      case 4'0001
        assign $4 [127:0] \cr1 [127:0]
      case 4'0010
        assign $4 [127:0] \cr2 [127:0]
      case 4'0011
        assign $4 [127:0] \cr3 [127:0]
      case 4'0100
        assign $4 [127:0] \cr4 [127:0]
      case 4'0101
        assign $4 [127:0] \cr5 [127:0]
      case 4'0110
        assign $4 [127:0] \cr6 [127:0]
      case 4'0111
        assign $4 [127:0] \cr7 [127:0]
      case 4'1000
        assign $4 [127:0] \cr8 [127:0]
      case 4'1001
        assign $4 [127:0] \cr9 [127:0]
      case 4'1010
        assign $4 [127:0] \cr10 [127:0]
      case 4'1011
        assign $4 [127:0] \cr11 [127:0]
      case 4'1100
        assign $4 [127:0] \cr12 [127:0]
      case 4'1101
        assign $4 [127:0] \cr13 [127:0]
      case 4'1110
        assign $4 [127:0] \cr14 [127:0]
      case 4'1111
        assign $4 [127:0] \cr15 [127:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:118"
  cell $eq $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:118"
  process $38
    assign $6 [31:0] 32'00000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $6 [31:0] \dr0 [31:0]
      case 4'0001
        assign $6 [31:0] \dr1 [31:0]
      case 4'0010
        assign $6 [31:0] \dr2 [31:0]
      case 4'0011
        assign $6 [31:0] \dr3 [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:118"
  cell $mux $39
    parameter \WIDTH 32
    connect \S $5 [0]
    connect \A $6 [31:0]
    connect \B 32'00000000000000000000000000000000
    connect \Y \dr_rd_data1
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:119"
  cell $eq $40
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:119"
  process $41
    assign $8 [31:0] 32'00000000000000000000000000000000
    switch 4'0000
      case 4'0000
        assign $8 [31:0] \dr0 [31:0]
      case 4'0001
        assign $8 [31:0] \dr1 [31:0]
      case 4'0010
        assign $8 [31:0] \dr2 [31:0]
      case 4'0011
        assign $8 [31:0] \dr3 [31:0]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:119"
  cell $mux $42
    parameter \WIDTH 32
    connect \S $7 [0]
    connect \A $8 [31:0]
    connect \B 32'00000000000000000000000000000000
    connect \Y \dr_rd_data2
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:111"
  cell $ne $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:111"
  cell $and $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $9 [0]
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:34"
  process $45
    assign \cr_word_rd_data [31:0] 32'00000000000000000000000000000000
    switch 2'00
      case 2'00
        assign \cr_word_rd_data [31:0] $1 [31:0]
      case 2'01
        assign \cr_word_rd_data [31:0] $2 [63:32]
      case 2'10
        assign \cr_word_rd_data [31:0] $3 [95:64]
      case 2'11
        assign \cr_word_rd_data [31:0] $4 [127:96]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $46
    assign $11 [127:0] \cr0 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $11 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
                assign $11 [127:0] \cr_wr_data [127:0]
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                    assign $11 [31:0] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                    assign $11 [63:32] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                    assign $11 [95:64] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                    assign $11 [127:96] 32'00000000000000000000000000000000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr0_gt_wr_en [0]
          case 1'1
            assign $11 [31:0] \cr0_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $11 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $47
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $11 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr0
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $48
    assign $12 [127:0] \cr1 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $12 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
                assign $12 [127:0] \cr_wr_data [127:0]
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [31:0] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [63:32] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [95:64] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                    assign $12 [127:96] 32'00000000000000000000000000000000
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr1_gt_wr_en [0]
          case 1'1
            assign $12 [31:0] \cr1_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $12 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $49
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $12 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr1
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $50
    assign $13 [127:0] \cr2 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
                assign $13 [127:0] \cr_wr_data [127:0]
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [31:0] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [63:32] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [95:64] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                    assign $13 [127:96] 32'00000000000000000000000000000000
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr2_gt_wr_en [0]
          case 1'1
            assign $13 [31:0] \cr2_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $51
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $13 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr2
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $52
    assign $14 [127:0] \cr3 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $14 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
                assign $14 [127:0] \cr_wr_data [127:0]
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [31:0] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [63:32] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [95:64] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                    assign $14 [127:96] 32'00000000000000000000000000000000
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr3_gt_wr_en [0]
          case 1'1
            assign $14 [31:0] \cr3_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $14 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $53
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $14 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr3
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $54
    assign $15 [127:0] \cr4 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $15 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
                assign $15 [127:0] \cr_wr_data [127:0]
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [31:0] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [63:32] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [95:64] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                    assign $15 [127:96] 32'00000000000000000000000000000000
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr4_gt_wr_en [0]
          case 1'1
            assign $15 [31:0] \cr4_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $15 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $55
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $15 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr4
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $56
    assign $16 [127:0] \cr5 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $16 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
                assign $16 [127:0] \cr_wr_data [127:0]
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [31:0] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [63:32] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [95:64] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                    assign $16 [127:96] 32'00000000000000000000000000000000
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr5_gt_wr_en [0]
          case 1'1
            assign $16 [31:0] \cr5_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $16 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $57
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $16 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr5
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $58
    assign $17 [127:0] \cr6 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $17 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
                assign $17 [127:0] \cr_wr_data [127:0]
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [31:0] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [63:32] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [95:64] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                    assign $17 [127:96] 32'00000000000000000000000000000000
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr6_gt_wr_en [0]
          case 1'1
            assign $17 [31:0] \cr6_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $17 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $59
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $17 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr6
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $60
    assign $18 [127:0] \cr7 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $18 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
                assign $18 [127:0] \cr_wr_data [127:0]
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [31:0] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [63:32] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [95:64] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                    assign $18 [127:96] 32'00000000000000000000000000000000
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr7_gt_wr_en [0]
          case 1'1
            assign $18 [31:0] \cr7_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $18 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $61
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $18 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr7
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $62
    assign $19 [127:0] \cr8 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $19 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
                assign $19 [127:0] \cr_wr_data [127:0]
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [31:0] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [63:32] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [95:64] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                    assign $19 [127:96] 32'00000000000000000000000000000000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr8_gt_wr_en [0]
          case 1'1
            assign $19 [31:0] \cr8_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $19 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $63
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $19 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr8
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $64
    assign $20 [127:0] \cr9 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $20 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
                assign $20 [127:0] \cr_wr_data [127:0]
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [31:0] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [63:32] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [95:64] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                    assign $20 [127:96] 32'00000000000000000000000000000000
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr9_gt_wr_en [0]
          case 1'1
            assign $20 [31:0] \cr9_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $20 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $65
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $20 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr9
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $66
    assign $21 [127:0] \cr10 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $21 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
                assign $21 [127:0] \cr_wr_data [127:0]
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [31:0] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [63:32] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [95:64] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                    assign $21 [127:96] 32'00000000000000000000000000000000
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr10_gt_wr_en [0]
          case 1'1
            assign $21 [31:0] \cr10_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $21 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $67
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $21 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr10
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $68
    assign $22 [127:0] \cr11 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $22 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
                assign $22 [127:0] \cr_wr_data [127:0]
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [31:0] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [63:32] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [95:64] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                    assign $22 [127:96] 32'00000000000000000000000000000000
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr11_gt_wr_en [0]
          case 1'1
            assign $22 [31:0] \cr11_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $22 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $69
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $22 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr11
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $70
    assign $23 [127:0] \cr12 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $23 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
                assign $23 [127:0] \cr_wr_data [127:0]
              case 4'1101
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [31:0] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [63:32] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [95:64] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                    assign $23 [127:96] 32'00000000000000000000000000000000
                  case 4'1101
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr12_gt_wr_en [0]
          case 1'1
            assign $23 [31:0] \cr12_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $23 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $71
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $23 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr12
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $72
    assign $24 [127:0] \cr13 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $24 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
                assign $24 [127:0] \cr_wr_data [127:0]
              case 4'1110
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [31:0] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [63:32] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [95:64] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                    assign $24 [127:96] 32'00000000000000000000000000000000
                  case 4'1110
                  case 4'1111
                end
            end
        end
        switch \cr13_gt_wr_en [0]
          case 1'1
            assign $24 [31:0] \cr13_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $24 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $73
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $24 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr13
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $74
    assign $25 [127:0] \cr14 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $25 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
                assign $25 [127:0] \cr_wr_data [127:0]
              case 4'1111
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [31:0] 32'00000000000000000000000000000000
                  case 4'1111
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [63:32] 32'00000000000000000000000000000000
                  case 4'1111
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [95:64] 32'00000000000000000000000000000000
                  case 4'1111
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                    assign $25 [127:96] 32'00000000000000000000000000000000
                  case 4'1111
                end
            end
        end
        switch \cr14_gt_wr_en [0]
          case 1'1
            assign $25 [31:0] \cr14_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $25 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $75
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $25 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr14
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  process $76
    assign $26 [127:0] \cr15 [127:0]
    switch \clear_all [0]
      case 1'1
        assign $26 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
      case
        switch \cr_wr_en [0]
          case 1'1
            switch \cr_wr_addr [3:0]
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
              case 4'0100
              case 4'0101
              case 4'0110
              case 4'0111
              case 4'1000
              case 4'1001
              case 4'1010
              case 4'1011
              case 4'1100
              case 4'1101
              case 4'1110
              case 4'1111
                assign $26 [127:0] \cr_wr_data [127:0]
            end
        end
        switch 1'0
          case 1'1
            switch 2'00
              case 2'00
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [31:0] 32'00000000000000000000000000000000
                end
              case 2'01
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [63:32] 32'00000000000000000000000000000000
                end
              case 2'10
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [95:64] 32'00000000000000000000000000000000
                end
              case 2'11
                switch 4'0000
                  case 4'0000
                  case 4'0001
                  case 4'0010
                  case 4'0011
                  case 4'0100
                  case 4'0101
                  case 4'0110
                  case 4'0111
                  case 4'1000
                  case 4'1001
                  case 4'1010
                  case 4'1011
                  case 4'1100
                  case 4'1101
                  case 4'1110
                  case 4'1111
                    assign $26 [127:96] 32'00000000000000000000000000000000
                end
            end
        end
        switch \cr15_gt_wr_en [0]
          case 1'1
            assign $26 [31:0] \cr15_gt_wr_data [31:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $26 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:61"
  cell $dff $77
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $26 [127:0]
    connect \CLK \clk [0]
    connect \Q \cr15
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $78
    assign $27 [31:0] \dr0 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $27 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
                assign $27 [31:0] 32'00000000000000000000000000000000
              case 4'0001
              case 4'0010
              case 4'0011
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $27 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $79
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $27 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr0
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $80
    assign $28 [31:0] \dr1 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $28 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
              case 4'0001
                assign $28 [31:0] 32'00000000000000000000000000000000
              case 4'0010
              case 4'0011
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $28 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $81
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $28 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr1
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $82
    assign $29 [31:0] \dr2 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $29 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
              case 4'0001
              case 4'0010
                assign $29 [31:0] 32'00000000000000000000000000000000
              case 4'0011
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $29 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $83
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $29 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr2
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  process $84
    assign $30 [31:0] \dr3 [31:0]
    switch \clear_all [0]
      case 1'1
        assign $30 [31:0] 32'00000000000000000000000000000000
      case
        switch $10 [0]
          case 1'1
            switch 4'0000
              case 4'0000
              case 4'0001
              case 4'0010
              case 4'0011
                assign $30 [31:0] 32'00000000000000000000000000000000
            end
        end
    end
    switch \rst [0]
      case 1'1
        assign $30 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:62"
  cell $dff $85
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $30 [31:0]
    connect \CLK \clk [0]
    connect \Q \dr3
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  process $86
    assign $31 [3:0] \flags [3:0]
    switch \clear_all [0]
      case 1'1
        assign $31 [3:0] 4'0000
      case
        switch 1'0
          case 1'1
            assign $31 [3:0] 4'0000
        end
    end
    switch \rst [0]
      case 1'1
        assign $31 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/registers.py:63"
  cell $dff $87
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $31 [3:0]
    connect \CLK \clk [0]
    connect \Q \flags
  end

connect \cr_word_rd_sel 2'00
connect \cr_word_rd_addr 4'0000
connect \cr6_clist \cr6 [127:0]
connect \cr14_cloomc \cr14 [127:0]
connect \cr8_thread \cr8 [127:0]
connect \cr15_namespace \cr15 [127:0]
connect \dr_rd_addr1 4'0000
connect \dr_rd_addr2 4'0000
connect \flags_reg \flags [3:0]
connect \cr_word_wr_en 1'0
connect \cr_word_sel 2'00
connect \cr_word_wr_addr 4'0000
connect \cr_word_wr_data 32'00000000000000000000000000000000
connect \dr_wr_en 1'0
connect \dr_wr_addr 4'0000
connect \dr_wr_data 32'00000000000000000000000000000000
connect \flags_wr_en 1'0
connect \flags_in 4'0000
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]
connect \cr0.word0_gt \cr0 [31:0]
connect \cr0.word0_gt.gt_type \cr0 [1:0]
connect \cr0.word0_gt.perms \cr0 [7:2]
connect \cr0.word0_gt.index \cr0 [24:8]
connect \cr0.word0_gt.version \cr0 [31:25]
connect \cr0.word1_location \cr0 [63:32]
connect \cr0.word2_limit \cr0 [95:64]
connect \cr0.word3_seals \cr0 [127:96]
connect \cr1.word0_gt \cr1 [31:0]
connect \cr1.word0_gt.gt_type \cr1 [1:0]
connect \cr1.word0_gt.perms \cr1 [7:2]
connect \cr1.word0_gt.index \cr1 [24:8]
connect \cr1.word0_gt.version \cr1 [31:25]
connect \cr1.word1_location \cr1 [63:32]
connect \cr1.word2_limit \cr1 [95:64]
connect \cr1.word3_seals \cr1 [127:96]
connect \cr2.word0_gt \cr2 [31:0]
connect \cr2.word0_gt.gt_type \cr2 [1:0]
connect \cr2.word0_gt.perms \cr2 [7:2]
connect \cr2.word0_gt.index \cr2 [24:8]
connect \cr2.word0_gt.version \cr2 [31:25]
connect \cr2.word1_location \cr2 [63:32]
connect \cr2.word2_limit \cr2 [95:64]
connect \cr2.word3_seals \cr2 [127:96]
connect \cr3.word0_gt \cr3 [31:0]
connect \cr3.word0_gt.gt_type \cr3 [1:0]
connect \cr3.word0_gt.perms \cr3 [7:2]
connect \cr3.word0_gt.index \cr3 [24:8]
connect \cr3.word0_gt.version \cr3 [31:25]
connect \cr3.word1_location \cr3 [63:32]
connect \cr3.word2_limit \cr3 [95:64]
connect \cr3.word3_seals \cr3 [127:96]
connect \cr4.word0_gt \cr4 [31:0]
connect \cr4.word0_gt.gt_type \cr4 [1:0]
connect \cr4.word0_gt.perms \cr4 [7:2]
connect \cr4.word0_gt.index \cr4 [24:8]
connect \cr4.word0_gt.version \cr4 [31:25]
connect \cr4.word1_location \cr4 [63:32]
connect \cr4.word2_limit \cr4 [95:64]
connect \cr4.word3_seals \cr4 [127:96]
connect \cr5.word0_gt \cr5 [31:0]
connect \cr5.word0_gt.gt_type \cr5 [1:0]
connect \cr5.word0_gt.perms \cr5 [7:2]
connect \cr5.word0_gt.index \cr5 [24:8]
connect \cr5.word0_gt.version \cr5 [31:25]
connect \cr5.word1_location \cr5 [63:32]
connect \cr5.word2_limit \cr5 [95:64]
connect \cr5.word3_seals \cr5 [127:96]
connect \cr6.word0_gt \cr6 [31:0]
connect \cr6.word0_gt.gt_type \cr6 [1:0]
connect \cr6.word0_gt.perms \cr6 [7:2]
connect \cr6.word0_gt.index \cr6 [24:8]
connect \cr6.word0_gt.version \cr6 [31:25]
connect \cr6.word1_location \cr6 [63:32]
connect \cr6.word2_limit \cr6 [95:64]
connect \cr6.word3_seals \cr6 [127:96]
connect \cr7.word0_gt \cr7 [31:0]
connect \cr7.word0_gt.gt_type \cr7 [1:0]
connect \cr7.word0_gt.perms \cr7 [7:2]
connect \cr7.word0_gt.index \cr7 [24:8]
connect \cr7.word0_gt.version \cr7 [31:25]
connect \cr7.word1_location \cr7 [63:32]
connect \cr7.word2_limit \cr7 [95:64]
connect \cr7.word3_seals \cr7 [127:96]
connect \cr8.word0_gt \cr8 [31:0]
connect \cr8.word0_gt.gt_type \cr8 [1:0]
connect \cr8.word0_gt.perms \cr8 [7:2]
connect \cr8.word0_gt.index \cr8 [24:8]
connect \cr8.word0_gt.version \cr8 [31:25]
connect \cr8.word1_location \cr8 [63:32]
connect \cr8.word2_limit \cr8 [95:64]
connect \cr8.word3_seals \cr8 [127:96]
connect \cr9.word0_gt \cr9 [31:0]
connect \cr9.word0_gt.gt_type \cr9 [1:0]
connect \cr9.word0_gt.perms \cr9 [7:2]
connect \cr9.word0_gt.index \cr9 [24:8]
connect \cr9.word0_gt.version \cr9 [31:25]
connect \cr9.word1_location \cr9 [63:32]
connect \cr9.word2_limit \cr9 [95:64]
connect \cr9.word3_seals \cr9 [127:96]
connect \cr10.word0_gt \cr10 [31:0]
connect \cr10.word0_gt.gt_type \cr10 [1:0]
connect \cr10.word0_gt.perms \cr10 [7:2]
connect \cr10.word0_gt.index \cr10 [24:8]
connect \cr10.word0_gt.version \cr10 [31:25]
connect \cr10.word1_location \cr10 [63:32]
connect \cr10.word2_limit \cr10 [95:64]
connect \cr10.word3_seals \cr10 [127:96]
connect \cr11.word0_gt \cr11 [31:0]
connect \cr11.word0_gt.gt_type \cr11 [1:0]
connect \cr11.word0_gt.perms \cr11 [7:2]
connect \cr11.word0_gt.index \cr11 [24:8]
connect \cr11.word0_gt.version \cr11 [31:25]
connect \cr11.word1_location \cr11 [63:32]
connect \cr11.word2_limit \cr11 [95:64]
connect \cr11.word3_seals \cr11 [127:96]
connect \cr12.word0_gt \cr12 [31:0]
connect \cr12.word0_gt.gt_type \cr12 [1:0]
connect \cr12.word0_gt.perms \cr12 [7:2]
connect \cr12.word0_gt.index \cr12 [24:8]
connect \cr12.word0_gt.version \cr12 [31:25]
connect \cr12.word1_location \cr12 [63:32]
connect \cr12.word2_limit \cr12 [95:64]
connect \cr12.word3_seals \cr12 [127:96]
connect \cr13.word0_gt \cr13 [31:0]
connect \cr13.word0_gt.gt_type \cr13 [1:0]
connect \cr13.word0_gt.perms \cr13 [7:2]
connect \cr13.word0_gt.index \cr13 [24:8]
connect \cr13.word0_gt.version \cr13 [31:25]
connect \cr13.word1_location \cr13 [63:32]
connect \cr13.word2_limit \cr13 [95:64]
connect \cr13.word3_seals \cr13 [127:96]
connect \cr14.word0_gt \cr14 [31:0]
connect \cr14.word0_gt.gt_type \cr14 [1:0]
connect \cr14.word0_gt.perms \cr14 [7:2]
connect \cr14.word0_gt.index \cr14 [24:8]
connect \cr14.word0_gt.version \cr14 [31:25]
connect \cr14.word1_location \cr14 [63:32]
connect \cr14.word2_limit \cr14 [95:64]
connect \cr14.word3_seals \cr14 [127:96]
connect \cr15.word0_gt \cr15 [31:0]
connect \cr15.word0_gt.gt_type \cr15 [1:0]
connect \cr15.word0_gt.perms \cr15 [7:2]
connect \cr15.word0_gt.index \cr15 [24:8]
connect \cr15.word0_gt.version \cr15 [31:25]
connect \cr15.word1_location \cr15 [63:32]
connect \cr15.word2_limit \cr15 [95:64]
connect \cr15.word3_seals \cr15 [127:96]
connect \cr6_clist.word0_gt \cr6 [31:0]
connect \cr6_clist.word0_gt.gt_type \cr6 [1:0]
connect \cr6_clist.word0_gt.perms \cr6 [7:2]
connect \cr6_clist.word0_gt.index \cr6 [24:8]
connect \cr6_clist.word0_gt.version \cr6 [31:25]
connect \cr6_clist.word1_location \cr6 [63:32]
connect \cr6_clist.word2_limit \cr6 [95:64]
connect \cr6_clist.word3_seals \cr6 [127:96]
connect \cr14_cloomc.word0_gt \cr14 [31:0]
connect \cr14_cloomc.word0_gt.gt_type \cr14 [1:0]
connect \cr14_cloomc.word0_gt.perms \cr14 [7:2]
connect \cr14_cloomc.word0_gt.index \cr14 [24:8]
connect \cr14_cloomc.word0_gt.version \cr14 [31:25]
connect \cr14_cloomc.word1_location \cr14 [63:32]
connect \cr14_cloomc.word2_limit \cr14 [95:64]
connect \cr14_cloomc.word3_seals \cr14 [127:96]
connect \cr8_thread.word0_gt \cr8 [31:0]
connect \cr8_thread.word0_gt.gt_type \cr8 [1:0]
connect \cr8_thread.word0_gt.perms \cr8 [7:2]
connect \cr8_thread.word0_gt.index \cr8 [24:8]
connect \cr8_thread.word0_gt.version \cr8 [31:25]
connect \cr8_thread.word1_location \cr8 [63:32]
connect \cr8_thread.word2_limit \cr8 [95:64]
connect \cr8_thread.word3_seals \cr8 [127:96]
connect \cr15_namespace.word0_gt \cr15 [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15 [1:0]
connect \cr15_namespace.word0_gt.perms \cr15 [7:2]
connect \cr15_namespace.word0_gt.index \cr15 [24:8]
connect \cr15_namespace.word0_gt.version \cr15 [31:25]
connect \cr15_namespace.word1_location \cr15 [63:32]
connect \cr15_namespace.word2_limit \cr15 [95:64]
connect \cr15_namespace.word3_seals \cr15 [127:96]
connect \flags.N \flags [0]
connect \flags.Z \flags [1]
connect \flags.C \flags [2]
connect \flags.V \flags [3]
connect \flags_reg.N \flags [0]
connect \flags_reg.Z \flags [1]
connect \flags_reg.C \flags [2]
connect \flags_reg.V \flags [3]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr0_gt_wr_data.gt_type \cr0_gt_wr_data [1:0]
connect \cr0_gt_wr_data.perms \cr0_gt_wr_data [7:2]
connect \cr0_gt_wr_data.index \cr0_gt_wr_data [24:8]
connect \cr0_gt_wr_data.version \cr0_gt_wr_data [31:25]
connect \cr1_gt_wr_data.gt_type \cr1_gt_wr_data [1:0]
connect \cr1_gt_wr_data.perms \cr1_gt_wr_data [7:2]
connect \cr1_gt_wr_data.index \cr1_gt_wr_data [24:8]
connect \cr1_gt_wr_data.version \cr1_gt_wr_data [31:25]
connect \cr2_gt_wr_data.gt_type \cr2_gt_wr_data [1:0]
connect \cr2_gt_wr_data.perms \cr2_gt_wr_data [7:2]
connect \cr2_gt_wr_data.index \cr2_gt_wr_data [24:8]
connect \cr2_gt_wr_data.version \cr2_gt_wr_data [31:25]
connect \cr3_gt_wr_data.gt_type \cr3_gt_wr_data [1:0]
connect \cr3_gt_wr_data.perms \cr3_gt_wr_data [7:2]
connect \cr3_gt_wr_data.index \cr3_gt_wr_data [24:8]
connect \cr3_gt_wr_data.version \cr3_gt_wr_data [31:25]
connect \cr4_gt_wr_data.gt_type \cr4_gt_wr_data [1:0]
connect \cr4_gt_wr_data.perms \cr4_gt_wr_data [7:2]
connect \cr4_gt_wr_data.index \cr4_gt_wr_data [24:8]
connect \cr4_gt_wr_data.version \cr4_gt_wr_data [31:25]
connect \cr5_gt_wr_data.gt_type \cr5_gt_wr_data [1:0]
connect \cr5_gt_wr_data.perms \cr5_gt_wr_data [7:2]
connect \cr5_gt_wr_data.index \cr5_gt_wr_data [24:8]
connect \cr5_gt_wr_data.version \cr5_gt_wr_data [31:25]
connect \cr6_gt_wr_data.gt_type \cr6_gt_wr_data [1:0]
connect \cr6_gt_wr_data.perms \cr6_gt_wr_data [7:2]
connect \cr6_gt_wr_data.index \cr6_gt_wr_data [24:8]
connect \cr6_gt_wr_data.version \cr6_gt_wr_data [31:25]
connect \cr7_gt_wr_data.gt_type \cr7_gt_wr_data [1:0]
connect \cr7_gt_wr_data.perms \cr7_gt_wr_data [7:2]
connect \cr7_gt_wr_data.index \cr7_gt_wr_data [24:8]
connect \cr7_gt_wr_data.version \cr7_gt_wr_data [31:25]
connect \cr8_gt_wr_data.gt_type \cr8_gt_wr_data [1:0]
connect \cr8_gt_wr_data.perms \cr8_gt_wr_data [7:2]
connect \cr8_gt_wr_data.index \cr8_gt_wr_data [24:8]
connect \cr8_gt_wr_data.version \cr8_gt_wr_data [31:25]
connect \cr9_gt_wr_data.gt_type \cr9_gt_wr_data [1:0]
connect \cr9_gt_wr_data.perms \cr9_gt_wr_data [7:2]
connect \cr9_gt_wr_data.index \cr9_gt_wr_data [24:8]
connect \cr9_gt_wr_data.version \cr9_gt_wr_data [31:25]
connect \cr10_gt_wr_data.gt_type \cr10_gt_wr_data [1:0]
connect \cr10_gt_wr_data.perms \cr10_gt_wr_data [7:2]
connect \cr10_gt_wr_data.index \cr10_gt_wr_data [24:8]
connect \cr10_gt_wr_data.version \cr10_gt_wr_data [31:25]
connect \cr11_gt_wr_data.gt_type \cr11_gt_wr_data [1:0]
connect \cr11_gt_wr_data.perms \cr11_gt_wr_data [7:2]
connect \cr11_gt_wr_data.index \cr11_gt_wr_data [24:8]
connect \cr11_gt_wr_data.version \cr11_gt_wr_data [31:25]
connect \cr12_gt_wr_data.gt_type \cr12_gt_wr_data [1:0]
connect \cr12_gt_wr_data.perms \cr12_gt_wr_data [7:2]
connect \cr12_gt_wr_data.index \cr12_gt_wr_data [24:8]
connect \cr12_gt_wr_data.version \cr12_gt_wr_data [31:25]
connect \cr13_gt_wr_data.gt_type \cr13_gt_wr_data [1:0]
connect \cr13_gt_wr_data.perms \cr13_gt_wr_data [7:2]
connect \cr13_gt_wr_data.index \cr13_gt_wr_data [24:8]
connect \cr13_gt_wr_data.version \cr13_gt_wr_data [31:25]
connect \cr14_gt_wr_data.gt_type \cr14_gt_wr_data [1:0]
connect \cr14_gt_wr_data.perms \cr14_gt_wr_data [7:2]
connect \cr14_gt_wr_data.index \cr14_gt_wr_data [24:8]
connect \cr14_gt_wr_data.version \cr14_gt_wr_data [31:25]
connect \cr15_gt_wr_data.gt_type \cr15_gt_wr_data [1:0]
connect \cr15_gt_wr_data.perms \cr15_gt_wr_data [7:2]
connect \cr15_gt_wr_data.index \cr15_gt_wr_data [24:8]
connect \cr15_gt_wr_data.version \cr15_gt_wr_data [31:25]
connect \flags_in.N 1'0
connect \flags_in.Z 1'0
connect \flags_in.C 1'0
connect \flags_in.V 1'0

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/decoder.py:43"
module \top.core.u_decoder

  attribute \src "/home/runner/workspace/church_machine/decoder.py:29"
  wire width 5 \church_op

  attribute \src "/home/runner/workspace/church_machine/decoder.py:30"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/decoder.py:31"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/decoder.py:32"
  wire width 15 \immediate

  attribute \src "/home/runner/workspace/church_machine/decoder.py:35"
  wire width 15 \cap_index

  attribute \src "/home/runner/workspace/church_machine/decoder.py:34"
  wire width 4 \tperm_preset

  attribute \src "/home/runner/workspace/church_machine/decoder.py:36"
  wire width 15 \call_mask

  attribute \src "/home/runner/workspace/church_machine/decoder.py:37"
  wire width 4 \switch_target

  attribute \src "/home/runner/workspace/church_machine/decoder.py:66"
  wire width 1 \cond_pass

  attribute \src "/home/runner/workspace/church_machine/decoder.py:104"
  wire width 1 \valid_opcode

  attribute \src "/home/runner/workspace/church_machine/decoder.py:23"
  wire width 1 input 0  \instr_valid

  attribute \src "/home/runner/workspace/church_machine/decoder.py:26"
  wire width 1 output 1  \exec_enable

  attribute \src "/home/runner/workspace/church_machine/decoder.py:27"
  wire width 1 output 2  \is_church_op

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 4 input 3  \flags

  attribute \src "/home/runner/workspace/church_machine/decoder.py:40"
  wire width 1 output 4  \fault_valid

  attribute \src "/home/runner/workspace/church_machine/decoder.py:39"
  wire width 4 output 5  \fault

  attribute \src "/home/runner/workspace/church_machine/decoder.py:22"
  wire width 32 input 6  \instruction

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.N

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.Z

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.C

  attribute \src "/home/runner/workspace/church_machine/decoder.py:24"
  wire width 1 \flags.V

  attribute \src "/home/runner/workspace/church_machine/decoder.py:72"
  cell $not $22
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:76"
  cell $not $23
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [2]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:80"
  cell $not $24
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:84"
  cell $not $25
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [3]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:86"
  cell $not $26
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:86"
  cell $and $27
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [2]
    connect \B $5 [0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:88"
  cell $not $28
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [2]
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:88"
  cell $or $29
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $7 [0]
    connect \B \flags [1]
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:90"
  cell $eq $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:92"
  cell $ne $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:94"
  cell $not $32
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:94"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:94"
  cell $and $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $11 [0]
    connect \B $12 [0]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:96"
  cell $ne $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [0]
    connect \B \flags [3]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:96"
  cell $or $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \flags [1]
    connect \B $14 [0]
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:102"
  cell $and $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \instr_valid [0]
    connect \B \cond_pass [0]
    connect \Y \exec_enable
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:105"
  cell $le $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 4'1001
    connect \Y \valid_opcode
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:106"
  cell $and $39
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \valid_opcode [0]
    connect \B \instr_valid [0]
    connect \Y \is_church_op
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:114"
  cell $not $40
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \valid_opcode [0]
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:119"
  cell $eq $41
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 5
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \instruction [31:27]
    connect \B 3'110
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:120"
  cell $eq $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \instruction [3:0]
    connect \B 4'1110
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:121"
  cell $eq $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \instruction [3:0]
    connect \B 4'1111
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:120"
  cell $or $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $18 [0]
    connect \B $19 [0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:119"
  cell $and $45
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $17 [0]
    connect \B $20 [0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:66"
  process $46
    assign \cond_pass [0] 1'0
    switch \instruction [26:23]
      case 4'0000
        assign \cond_pass [0] \flags [1]
      case 4'0001
        assign \cond_pass [0] $1 [0]
      case 4'0010
        assign \cond_pass [0] \flags [2]
      case 4'0011
        assign \cond_pass [0] $2 [0]
      case 4'0100
        assign \cond_pass [0] \flags [0]
      case 4'0101
        assign \cond_pass [0] $3 [0]
      case 4'0110
        assign \cond_pass [0] \flags [3]
      case 4'0111
        assign \cond_pass [0] $4 [0]
      case 4'1000
        assign \cond_pass [0] $6 [0]
      case 4'1001
        assign \cond_pass [0] $8 [0]
      case 4'1010
        assign \cond_pass [0] $9 [0]
      case 4'1011
        assign \cond_pass [0] $10 [0]
      case 4'1100
        assign \cond_pass [0] $13 [0]
      case 4'1101
        assign \cond_pass [0] $15 [0]
      case 4'1110
        assign \cond_pass [0] 1'1
      case 4'1111
        assign \cond_pass [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:40"
  process $47
    assign \fault_valid [0] 1'0
    switch \instr_valid [0]
      case 1'1
        switch { $21 [0] $16 [0] }
          case 2'-1
            assign \fault_valid [0] 1'1
          case 2'1-
            assign \fault_valid [0] 1'1
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/decoder.py:39"
  process $48
    assign \fault [3:0] 4'0000
    switch \instr_valid [0]
      case 1'1
        switch { $21 [0] $16 [0] }
          case 2'-1
            assign \fault [3:0] 4'1011
          case 2'1-
            assign \fault [3:0] 4'1100
        end
    end
  end

connect \church_op \instruction [31:27]
connect \cr_dst \instruction [22:19]
connect \cr_src \instruction [18:15]
connect \immediate \instruction [14:0]
connect \cap_index \instruction [14:0]
connect \tperm_preset \instruction [3:0]
connect \call_mask \instruction [14:0]
connect \switch_target \instruction [3:0]
connect \flags.N \flags [0]
connect \flags.Z \flags [1]
connect \flags.C \flags [2]
connect \flags.V \flags [3]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/perm_check.py:38"
module \top.core.u_perm_check

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:43"
  wire width 1 \is_null_gt

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:44"
  wire width 1 \perms_match

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:26"
  wire width 1 \perm_granted

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:52"
  wire width 1 \has_turing

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:53"
  wire width 1 \has_church

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:35"
  wire width 1 \domain_purity_ok

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:27"
  wire width 1 \bounds_ok

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:16"
  wire width 1 \check_bounds

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:14"
  wire width 17 \access_index

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:15"
  wire width 32 \limit

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:28"
  wire width 1 \version_ok

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:20"
  wire width 1 \check_version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:19"
  wire width 7 \gt_version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:18"
  wire width 7 \stored_version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:29"
  wire width 1 \seal_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:24"
  wire width 1 \check_seal

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:22"
  wire width 25 \calculated_seal

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:23"
  wire width 25 \stored_seal

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:30"
  wire width 1 \all_checks_pass

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:12"
  wire width 1 input 0  \check_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:34"
  wire width 1 input 1  \check_domain_purity

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 32 input 2  \gt_in

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:11"
  wire width 6 input 3  \required_perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:32"
  wire width 1 output 4  \fault_valid

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:31"
  wire width 4 output 5  \fault_type

  wire width 6 $1

  wire width 1 $2

  wire width 6 $3

  wire width 6 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  wire width 1 $22

  wire width 6 $23

  wire width 6 $24

  wire width 6 $25

  wire width 6 $26

  wire width 1 $27

  wire width 6 $28

  wire width 6 $29

  wire width 6 $30

  wire width 6 $31

  wire width 1 $32

  wire width 6 $33

  wire width 6 $34

  wire width 6 $35

  wire width 6 $36

  wire width 1 $37

  wire width 6 $38

  wire width 6 $39

  wire width 6 $40

  wire width 6 $41

  wire width 1 $42

  wire width 6 $43

  wire width 6 $44

  wire width 6 $45

  wire width 6 $46

  wire width 1 $47

  wire width 6 $48

  wire width 6 $49

  wire width 6 $50

  wire width 6 $51

  wire width 1 $52

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 2 \gt_in.gt_type

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 6 \gt_in.perms

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 17 \gt_in.index

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:10"
  wire width 7 \gt_in.version

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:47"
  cell $eq $53
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \gt_in [1:0]
    connect \B 2'10
    connect \Y \is_null_gt
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:48"
  cell $and $54
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B \required_perms [5:0]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:48"
  cell $eq $55
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $1 [5:0]
    connect \B \required_perms [5:0]
    connect \Y \perms_match
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:49"
  cell $not $56
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \is_null_gt [0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:49"
  cell $and $57
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $2 [0]
    connect \B \perms_match [0]
    connect \Y \perm_granted
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:55"
  cell $and $58
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000111
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:55"
  cell $ne $59
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A $3 [5:0]
    connect \B {  }
    connect \Y \has_turing
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:56"
  cell $and $60
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'111000
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:56"
  cell $ne $61
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A $4 [5:0]
    connect \B {  }
    connect \Y \has_church
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:57"
  cell $and $62
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \has_turing [0]
    connect \B \has_church [0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:57"
  cell $not $63
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $5 [0]
    connect \Y \domain_purity_ok
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:60"
  cell $not $64
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:60"
  cell $lt $65
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:60"
  cell $or $66
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $6 [0]
    connect \B $7 [0]
    connect \Y \bounds_ok
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:61"
  cell $not $67
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:61"
  cell $eq $68
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:61"
  cell $or $69
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $8 [0]
    connect \B $9 [0]
    connect \Y \version_ok
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:62"
  cell $not $70
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:62"
  cell $eq $71
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 0
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A {  }
    connect \B {  }
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:62"
  cell $or $72
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $10 [0]
    connect \B $11 [0]
    connect \Y \seal_valid
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:65"
  cell $and $73
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \perm_granted [0]
    connect \B \bounds_ok [0]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:65"
  cell $and $74
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $12 [0]
    connect \B \version_ok [0]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:65"
  cell $and $75
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $13 [0]
    connect \B \seal_valid [0]
    connect \Y \all_checks_pass
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:79"
  cell $not $76
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \perms_match [0]
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:95"
  cell $not $77
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \bounds_ok [0]
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:95"
  cell $and $78
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $15 [0]
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:100"
  cell $not $79
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \version_ok [0]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:100"
  cell $and $80
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $17 [0]
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:105"
  cell $not $81
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \seal_valid [0]
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:105"
  cell $and $82
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A 1'0
    connect \B $19 [0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:110"
  cell $not $83
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \domain_purity_ok [0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:110"
  cell $and $84
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \check_domain_purity [0]
    connect \B $21 [0]
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $and $85
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'000001
    connect \Y $23
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $and $86
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000001
    connect \Y $24
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $not $87
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $24 [5:0]
    connect \Y $25
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:81"
  cell $and $88
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $23 [5:0]
    connect \B $25 [5:0]
    connect \Y $26
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $89
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $26 [5:0]
    connect \Y $27
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $and $90
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'000010
    connect \Y $28
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $and $91
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000010
    connect \Y $29
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $not $92
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $29 [5:0]
    connect \Y $30
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:83"
  cell $and $93
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $28 [5:0]
    connect \B $30 [5:0]
    connect \Y $31
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $94
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $31 [5:0]
    connect \Y $32
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $and $95
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'000100
    connect \Y $33
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $and $96
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'000100
    connect \Y $34
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $not $97
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $34 [5:0]
    connect \Y $35
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:85"
  cell $and $98
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $33 [5:0]
    connect \B $35 [5:0]
    connect \Y $36
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $99
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $36 [5:0]
    connect \Y $37
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $and $100
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'001000
    connect \Y $38
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $and $101
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'001000
    connect \Y $39
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $not $102
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $39 [5:0]
    connect \Y $40
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:87"
  cell $and $103
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $38 [5:0]
    connect \B $40 [5:0]
    connect \Y $41
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $104
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $41 [5:0]
    connect \Y $42
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $and $105
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'010000
    connect \Y $43
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $and $106
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'010000
    connect \Y $44
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $not $107
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $44 [5:0]
    connect \Y $45
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:89"
  cell $and $108
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $43 [5:0]
    connect \B $45 [5:0]
    connect \Y $46
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $109
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $46 [5:0]
    connect \Y $47
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $and $110
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \required_perms [5:0]
    connect \B 6'100000
    connect \Y $48
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $and $111
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \gt_in [7:2]
    connect \B 6'100000
    connect \Y $49
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $not $112
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $49 [5:0]
    connect \Y $50
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:91"
  cell $and $113
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A $48 [5:0]
    connect \B $50 [5:0]
    connect \Y $51
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:551"
  cell $reduce_bool $114
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $51 [5:0]
    connect \Y $52
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:32"
  process $115
    assign \fault_valid [0] 1'0
    switch \check_valid [0]
      case 1'1
        switch { $22 [0] $20 [0] $18 [0] $16 [0] $14 [0] \is_null_gt [0] }
          case 6'-----1
            assign \fault_valid [0] 1'1
          case 6'----1-
            assign \fault_valid [0] 1'1
          case 6'---1--
            assign \fault_valid [0] 1'1
          case 6'--1---
            assign \fault_valid [0] 1'1
          case 6'-1----
            assign \fault_valid [0] 1'1
          case 6'1-----
            assign \fault_valid [0] 1'1
        end
    end
  end

  attribute \src "/home/runner/workspace/church_machine/perm_check.py:31"
  process $116
    assign \fault_type [3:0] 4'0000
    switch \check_valid [0]
      case 1'1
        switch { $22 [0] $20 [0] $18 [0] $16 [0] $14 [0] \is_null_gt [0] }
          case 6'-----1
            assign \fault_type [3:0] 4'0111
          case 6'----1-
            switch { $52 [0] $47 [0] $42 [0] $37 [0] $32 [0] $27 [0] }
              case 6'-----1
                assign \fault_type [3:0] 4'0001
              case 6'----1-
                assign \fault_type [3:0] 4'0010
              case 6'---1--
                assign \fault_type [3:0] 4'0011
              case 6'--1---
                assign \fault_type [3:0] 4'0100
              case 6'-1----
                assign \fault_type [3:0] 4'0101
              case 6'1-----
                assign \fault_type [3:0] 4'0110
              case
                assign \fault_type [3:0] 4'0001
            end
          case 6'---1--
            assign \fault_type [3:0] 4'1000
          case 6'--1---
            assign \fault_type [3:0] 4'1001
          case 6'-1----
            assign \fault_type [3:0] 4'1010
          case 6'1-----
            assign \fault_type [3:0] 4'1101
        end
    end
  end

connect \check_bounds 1'0
connect \access_index 17'00000000000000000
connect \limit 32'00000000000000000000000000000000
connect \check_version 1'0
connect \gt_version 7'0000000
connect \stored_version 7'0000000
connect \check_seal 1'0
connect \calculated_seal 25'0000000000000000000000000
connect \stored_seal 25'0000000000000000000000000
connect \gt_in.gt_type \gt_in [1:0]
connect \gt_in.perms \gt_in [7:2]
connect \gt_in.index \gt_in [24:8]
connect \gt_in.version \gt_in [31:25]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:25"
module \top.core.u_lambda

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:32"
  wire width 1 \is_null

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \target_cap

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \lambda_state

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  attribute \init 1'0
  wire width 1 \fault_flag

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  attribute \init 4'0000
  wire width 4 \fault_latched

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:10"
  wire width 1 input 2  \lambda_start

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 128 input 3  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:12"
  wire width 1 output 4  \lambda_busy

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:13"
  wire width 1 output 5  \lambda_complete

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:17"
  wire width 4 output 6  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:20"
  wire width 1 output 7  \nia_set

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:21"
  wire width 32 output 8  \nia_value

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  attribute \init 1'0
  wire width 1 output 9  \lambda_fault

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  attribute \init 4'0000
  wire width 4 output 10  \fault_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:11"
  wire width 4 input 11  \cr_target

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 4 $8

  wire width 3 $9

  wire width 128 $10

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 2 \target_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 6 \target_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 17 \target_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 7 \target_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  wire width 32 \target_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:18"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:33"
  cell $eq $11
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \target_cap [1:0]
    connect \B 2'10
    connect \Y \is_null
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:74"
  cell $not $12
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \Y \lambda_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $13
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B {  }
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $14
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 1'1
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 2'10
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $16
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 2'11
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $17
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 3'100
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $18
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \lambda_state [2:0]
    connect \B 3'101
    connect \Y \lambda_complete
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:54"
  cell $not $19
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \target_cap [4]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:17"
  process $20
    assign \cr_rd_addr [3:0] 4'0000
    switch \lambda_state [2:0]
      case 3'000
        switch \lambda_start [0]
          case 1'1
            assign \cr_rd_addr [3:0] \cr_target [3:0]
        end
      case 3'001
        assign \cr_rd_addr [3:0] \cr_target [3:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:20"
  process $21
    assign \nia_set [0] 1'0
    switch \lambda_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \nia_set [0] 1'1
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:21"
  process $22
    assign \nia_value [31:0] 32'00000000000000000000000000000000
    switch \lambda_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \nia_value [31:0] \target_cap [63:32]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  process $23
    assign $7 [0] \lambda_fault [0]
    switch \lambda_state [2:0]
      case 3'000
        assign $7 [0] 1'0
      case 3'001
      case 3'010
        switch { $6 [0] \is_null [0] }
          case 2'-1
            assign $7 [0] 1'1
          case 2'1-
            assign $7 [0] 1'1
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $7 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:35"
  cell $dff $24
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $7 [0]
    connect \CLK \clk [0]
    connect \Q \lambda_fault
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  process $25
    assign $8 [3:0] \fault_type [3:0]
    switch \lambda_state [2:0]
      case 3'000
        assign $8 [3:0] 4'0000
      case 3'001
      case 3'010
        switch { $6 [0] \is_null [0] }
          case 2'-1
            assign $8 [3:0] 4'0111
          case 2'1-
            assign $8 [3:0] 4'0011
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $8 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:36"
  cell $dff $26
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $8 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $27
    assign $9 [2:0] \lambda_state [2:0]
    switch \lambda_state [2:0]
      case 3'000
        switch \lambda_start [0]
          case 1'1
            assign $9 [2:0] 3'001
        end
      case 3'001
        assign $9 [2:0] 3'010
      case 3'010
        switch { $6 [0] \is_null [0] }
          case 2'-1
            assign $9 [2:0] 3'011
          case 2'1-
            assign $9 [2:0] 3'011
          case
            assign $9 [2:0] 3'100
        end
      case 3'100
        assign $9 [2:0] 3'101
      case 3'101
        assign $9 [2:0] 3'000
      case 3'011
        assign $9 [2:0] 3'000
    end
    switch \rst [0]
      case 1'1
        assign $9 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $28
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $9 [2:0]
    connect \CLK \clk [0]
    connect \Q \lambda_state
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  process $29
    assign $10 [127:0] \target_cap [127:0]
    switch \lambda_state [2:0]
      case 3'000
      case 3'001
        assign $10 [127:0] \cr_rd_data [127:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $10 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/lambda_unit.py:27"
  cell $dff $30
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $10 [127:0]
    connect \CLK \clk [0]
    connect \Q \target_cap
  end

connect \fault_flag \lambda_fault [0]
connect \fault_latched \fault_type [3:0]
connect \target_cap.word0_gt \target_cap [31:0]
connect \target_cap.word0_gt.gt_type \target_cap [1:0]
connect \target_cap.word0_gt.perms \target_cap [7:2]
connect \target_cap.word0_gt.index \target_cap [24:8]
connect \target_cap.word0_gt.version \target_cap [31:25]
connect \target_cap.word1_location \target_cap [63:32]
connect \target_cap.word2_limit \target_cap [95:64]
connect \target_cap.word3_seals \target_cap [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/call.py:43"
module \top.core.u_call

  attribute \src "/home/runner/workspace/church_machine/call.py:66"
  wire width 1 \src_in_range

  attribute \src "/home/runner/workspace/church_machine/call.py:11"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/call.py:49"
  attribute \init 1'0
  wire width 1 \phase

  attribute \src "/home/runner/workspace/church_machine/call.py:74"
  wire width 4 \mload_dst

  attribute \src "/home/runner/workspace/church_machine/call.py:12"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  attribute \init 1'0
  wire width 1 \sub_start_reg

  attribute \src "/home/runner/workspace/church_machine/call.py:26"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/call.py:27"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/call.py:28"
  wire width 17 \mload_index$11

  attribute \src "/home/runner/workspace/church_machine/call.py:29"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/call.py:31"
  wire width 1 \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/call.py:30"
  wire width 32 \mload_direct_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:63"
  wire width 4 \b_clear_wr_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 128 \b_clear_wr_data

  attribute \src "/home/runner/workspace/church_machine/call.py:62"
  wire width 1 \b_clear_wr_en

  attribute \src "/home/runner/workspace/church_machine/call.py:58"
  wire width 4 \local_cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:103"
  wire width 16 \dr_clear_computed

  attribute \src "/home/runner/workspace/church_machine/call.py:51"
  attribute \init 16'0000000000000000
  wire width 16 \mask_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:104"
  wire width 16 \cr_clear_computed

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \call_state

  attribute \src "/home/runner/workspace/church_machine/call.py:60"
  attribute \init 3'000
  wire width 3 \b_idx

  attribute \src "/home/runner/workspace/church_machine/call.py:188"
  wire width 32 \cleared_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \b_cr_data

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  attribute \init 1'0
  wire width 1 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  attribute \init 4'0000
  wire width 4 \fault_type_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:37"
  wire width 1 \nia_set

  attribute \src "/home/runner/workspace/church_machine/call.py:38"
  wire width 32 \nia_value

  attribute \src "/home/runner/workspace/church_machine/call.py:39"
  wire width 16 \dr_clear_mask

  attribute \src "/home/runner/workspace/church_machine/call.py:40"
  wire width 16 \cr_clear_mask

  attribute \src "/home/runner/workspace/church_machine/call.py:55"
  attribute \init 1'0
  wire width 1 \sub_done_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:56"
  attribute \init 1'0
  wire width 1 \sub_fault_latched

  attribute \src "/home/runner/workspace/church_machine/call.py:13"
  wire width 16 \mask

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \src_reg_latched

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/call.py:10"
  wire width 1 input 2  \call_start

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 128 input 3  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/call.py:26"
  wire width 4 output 4  \mload_src

  wire width 3 output 5  \port$874$0

  attribute \src "/home/runner/workspace/church_machine/call.py:28"
  wire width 17 output 6  \mload_index

  attribute \src "/home/runner/workspace/church_machine/call.py:14"
  wire width 1 output 7  \call_busy

  attribute \src "/home/runner/workspace/church_machine/call.py:37"
  wire width 1 output 8  \call_complete

  attribute \src "/home/runner/workspace/church_machine/call.py:34"
  wire width 1 input 9  \mload_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:33"
  wire width 1 input 10  \mload_done

  attribute \src "/home/runner/workspace/church_machine/call.py:58"
  wire width 4 output 11  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 128 output 12  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/call.py:62"
  wire width 1 output 13  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/call.py:63"
  wire width 4 output 14  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  attribute \init 1'0
  wire width 1 output 15  \call_fault

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  attribute \init 4'0000
  wire width 4 output 16  \fault_type

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  attribute \init 1'0
  wire width 1 output 17  \mload_start

  attribute \src "/home/runner/workspace/church_machine/call.py:35"
  wire width 4 input 18  \mload_fault_type

  wire width 19 input 19  \port$1565$0

  wire width 3 $1

  wire width 5 $2

  wire width 6 $3

  wire width 1 $4

  wire width 1 $5

  wire width 33 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  wire width 1 $22

  wire width 4 $23

  wire width 4 $24

  wire width 1 $25

  wire width 1 $26

  wire width 4 $27

  wire width 1 $28

  wire width 1 $29

  wire width 16 $30

  wire width 4 $31

  wire width 128 $32

  wire width 1 $33

  wire width 3 $34

  wire width 128 $35

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:22"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 2 \b_clear_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 6 \b_clear_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 17 \b_clear_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 7 \b_clear_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  wire width 32 \b_clear_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 2 \b_cr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 6 \b_cr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 17 \b_cr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 7 \b_cr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  wire width 32 \b_cr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 2 \src_reg_latched.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 6 \src_reg_latched.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 17 \src_reg_latched.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 7 \src_reg_latched.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  wire width 32 \src_reg_latched.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/call.py:20"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/call.py:67"
  cell $le $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \port$1565$0 [18:15]
    connect \B 3'101
    connect \Y \src_in_range
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:77"
  cell $mux $37
    parameter \WIDTH 4
    connect \S \phase [0]
    connect \A \port$1565$0 [18:15]
    connect \B 4'0110
    connect \Y \mload_src
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:78"
  cell $mux $38
    parameter \WIDTH 3
    connect \S \phase [0]
    connect \A 3'110
    connect \B 3'111
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:79"
  cell $mux $39
    parameter \WIDTH 17
    connect \S \phase [0]
    connect \A { 2'00 \port$1565$0 [14:0] }
    connect \B 17'00000000000000000
    connect \Y \mload_index
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:106"
  cell $not $40
    parameter \A_SIGNED 0
    parameter \A_WIDTH 5
    parameter \Y_WIDTH 5
    connect \A \mask_latched [4:0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:107"
  cell $not $41
    parameter \A_SIGNED 0
    parameter \A_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \mask_latched [10:5]
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:173"
  cell $gt $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \b_idx [2:0]
    connect \B 3'101
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:175"
  cell $shift $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mask_latched [10:5]
    connect \B \b_idx [2:0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:189"
  cell $and $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 33
    parameter \B_WIDTH 33
    parameter \Y_WIDTH 33
    connect \A { 1'0 \b_cr_data [95:64] }
    connect \B 33'101111111111111111111111111111111
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:209"
  cell $not $45
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $7 [0]
    connect \Y \call_busy
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:215"
  cell $mux $46
    parameter \WIDTH 16
    connect \S \call_complete [0]
    connect \A 16'0000000000000000
    connect \B { 10'1111111111 $2 [4:0] 1'0 }
    connect \Y \dr_clear_mask
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:216"
  cell $mux $47
    parameter \WIDTH 16
    connect \S \call_complete [0]
    connect \A 16'0000000000000000
    connect \B { 10'0000000000 $3 [5:0] }
    connect \Y \cr_clear_mask
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $48
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B {  }
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $49
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 1'1
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $50
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 2'10
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $51
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 2'11
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $52
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'100
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $53
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'101
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $54
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'110
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $55
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 3'111
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $56
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1000
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $57
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1001
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $58
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1010
    connect \Y \call_complete
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $59
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1011
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $60
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \call_state [3:0]
    connect \B 4'1100
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:120"
  cell $not $61
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \src_in_range [0]
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:132"
  cell $not $62
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \src_reg_latched [5]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:173"
  cell $gt $63
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \b_idx [2:0]
    connect \B 3'101
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:175"
  cell $shift $64
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mask_latched [10:5]
    connect \B \b_idx [2:0]
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:179"
  cell $add $65
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 4
    connect \A \b_idx [2:0]
    connect \B 1'1
    connect \Y $23
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:199"
  cell $add $66
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 4
    connect \A \b_idx [2:0]
    connect \B 1'1
    connect \Y $24
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:58"
  process $67
    assign \cr_rd_addr [3:0] 4'0000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
        assign \cr_rd_addr [3:0] \port$1565$0 [18:15]
      case 4'0011
        assign \cr_rd_addr [3:0] \port$1565$0 [18:15]
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
        switch { $5 [0] $4 [0] }
          case 2'-1
          case 2'1-
            assign \cr_rd_addr [3:0] { 1'0 \b_idx [2:0] }
          case
        end
      case 4'1011
        assign \cr_rd_addr [3:0] { 1'0 \b_idx [2:0] }
      case 4'1100
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:188"
  process $68
    assign \cleared_limit [31:0] 32'00000000000000000000000000000000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cleared_limit [31:0] $6 [31:0]
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:64"
  process $69
    assign \cr_wr_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cr_wr_data [31:0] \b_cr_data [31:0]
        assign \cr_wr_data [63:32] \b_cr_data [63:32]
        assign \cr_wr_data [95:64] \cleared_limit [31:0]
        assign \cr_wr_data [127:96] \b_cr_data [127:96]
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:62"
  process $70
    assign \cr_wr_en [0] 1'0
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cr_wr_en [0] 1'1
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:63"
  process $71
    assign \cr_wr_addr [3:0] 4'0000
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
        assign \cr_wr_addr [3:0] { 1'0 \b_idx [2:0] }
      case 4'1010
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:49"
  process $72
    assign $25 [0] \phase [0]
    switch \call_state [3:0]
      case 4'0000
        assign $25 [0] 1'0
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        assign $25 [0] 1'1
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $25 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:49"
  cell $dff $73
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $25 [0]
    connect \CLK \clk [0]
    connect \Q \phase
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  process $74
    assign $26 [0] \call_fault [0]
    switch \call_state [3:0]
      case 4'0000
        assign $26 [0] 1'0
      case 4'0001
        switch $19 [0]
          case 1'1
            assign $26 [0] 1'1
          case
        end
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
            assign $26 [0] 1'1
          case
        end
      case 4'0101
        switch \mload_fault [0]
          case 1'1
            assign $26 [0] 1'1
        end
      case 4'0110
      case 4'0111
        switch \mload_fault [0]
          case 1'1
            assign $26 [0] 1'1
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $26 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:52"
  cell $dff $75
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $26 [0]
    connect \CLK \clk [0]
    connect \Q \call_fault
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  process $76
    assign $27 [3:0] \fault_type [3:0]
    switch \call_state [3:0]
      case 4'0000
        assign $27 [3:0] 4'0000
      case 4'0001
        switch $19 [0]
          case 1'1
            assign $27 [3:0] 4'0100
          case
        end
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
            assign $27 [3:0] 4'0100
          case
        end
      case 4'0101
        switch \mload_fault [0]
          case 1'1
            assign $27 [3:0] \mload_fault_type [3:0]
        end
      case 4'0110
      case 4'0111
        switch \mload_fault [0]
          case 1'1
            assign $27 [3:0] \mload_fault_type [3:0]
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $27 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:53"
  cell $dff $77
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $27 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:55"
  process $78
    assign $28 [0] \sub_done_latched [0]
    switch \call_state [3:0]
      case 4'0000
        assign $28 [0] 1'0
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        switch \mload_done [0]
          case 1'1
            assign $28 [0] 1'1
        end
      case 4'0110
        assign $28 [0] 1'0
      case 4'0111
        switch \mload_done [0]
          case 1'1
            assign $28 [0] 1'1
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $28 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:55"
  cell $dff $79
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $28 [0]
    connect \CLK \clk [0]
    connect \Q \sub_done_latched
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:56"
  process $80
    assign $29 [0] \sub_fault_latched [0]
    switch \call_state [3:0]
      case 4'0000
        assign $29 [0] 1'0
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        switch \mload_fault [0]
          case 1'1
            assign $29 [0] 1'1
        end
      case 4'0110
        assign $29 [0] 1'0
      case 4'0111
        switch \mload_fault [0]
          case 1'1
            assign $29 [0] 1'1
        end
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $29 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:56"
  cell $dff $81
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $29 [0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_latched
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:51"
  process $82
    assign $30 [15:0] \mask_latched [15:0]
    switch \call_state [3:0]
      case 4'0000
        switch \call_start [0]
          case 1'1
            assign $30 [15:0] { 1'0 \port$1565$0 [14:0] }
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $30 [15:0] 16'0000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:51"
  cell $dff $83
    parameter \WIDTH 16
    parameter \CLK_POLARITY 1
    connect \D $30 [15:0]
    connect \CLK \clk [0]
    connect \Q \mask_latched
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $84
    assign $31 [3:0] \call_state [3:0]
    switch \call_state [3:0]
      case 4'0000
        switch \call_start [0]
          case 1'1
            assign $31 [3:0] 4'0001
        end
      case 4'0001
        switch $19 [0]
          case 1'1
            assign $31 [3:0] 4'0010
          case
            assign $31 [3:0] 4'0011
        end
      case 4'0011
        assign $31 [3:0] 4'0100
      case 4'0100
        switch $20 [0]
          case 1'1
            assign $31 [3:0] 4'0010
          case
            assign $31 [3:0] 4'0101
        end
      case 4'0101
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $31 [3:0] 4'0010
          case 2'1-
            assign $31 [3:0] 4'0110
        end
      case 4'0110
        assign $31 [3:0] 4'0111
      case 4'0111
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $31 [3:0] 4'0010
          case 2'1-
            assign $31 [3:0] 4'1000
        end
      case 4'1000
        assign $31 [3:0] 4'1001
      case 4'1001
        switch { $22 [0] $21 [0] }
          case 2'-1
            assign $31 [3:0] 4'1010
          case 2'1-
            assign $31 [3:0] 4'1011
          case
        end
      case 4'1011
        assign $31 [3:0] 4'1100
      case 4'1100
        assign $31 [3:0] 4'1001
      case 4'1010
        assign $31 [3:0] 4'0000
      case 4'0010
        assign $31 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $31 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $85
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $31 [3:0]
    connect \CLK \clk [0]
    connect \Q \call_state
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  process $86
    assign $32 [127:0] \src_reg_latched [127:0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
        assign $32 [127:0] \cr_rd_data [127:0]
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $32 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:50"
  cell $dff $87
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $32 [127:0]
    connect \CLK \clk [0]
    connect \Q \src_reg_latched
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  process $88
    assign $33 [0] \mload_start [0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
        switch $20 [0]
          case 1'1
          case
            assign $33 [0] 1'1
        end
      case 4'0101
        assign $33 [0] 1'0
      case 4'0110
        assign $33 [0] 1'1
      case 4'0111
        assign $33 [0] 1'0
      case 4'1000
      case 4'1001
      case 4'1011
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $33 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:54"
  cell $dff $89
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $33 [0]
    connect \CLK \clk [0]
    connect \Q \mload_start
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:60"
  process $90
    assign $34 [2:0] \b_idx [2:0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign $34 [2:0] 3'000
      case 4'1001
        switch { $22 [0] $21 [0] }
          case 2'-1
          case 2'1-
          case
            assign $34 [2:0] $23 [2:0]
        end
      case 4'1011
      case 4'1100
        assign $34 [2:0] $24 [2:0]
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $34 [2:0] 3'000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:60"
  cell $dff $91
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $34 [2:0]
    connect \CLK \clk [0]
    connect \Q \b_idx
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  process $92
    assign $35 [127:0] \b_cr_data [127:0]
    switch \call_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1011
        assign $35 [127:0] \cr_rd_data [127:0]
      case 4'1100
      case 4'1010
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $35 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/call.py:61"
  cell $dff $93
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $35 [127:0]
    connect \CLK \clk [0]
    connect \Q \b_cr_data
  end

connect \cr_src \port$1565$0 [18:15]
connect \mload_dst { 1'0 $1 [2:0] }
connect \index { 2'00 \port$1565$0 [14:0] }
connect \sub_start_reg \mload_start [0]
connect \mload_cr_src \mload_src [3:0]
connect \mload_cr_dst { 1'0 $1 [2:0] }
connect \mload_index$11 \mload_index [16:0]
connect \mload_direct 1'0
connect \mload_m_elevated 1'1
connect \mload_direct_gt 32'00000000000000000000000000000000
connect \b_clear_wr_addr \cr_wr_addr [3:0]
connect \b_clear_wr_data \cr_wr_data [127:0]
connect \b_clear_wr_en \cr_wr_en [0]
connect \local_cr_rd_addr \cr_rd_addr [3:0]
connect \dr_clear_computed { 10'1111111111 $2 [4:0] 1'0 }
connect \cr_clear_computed { 10'0000000000 $3 [5:0] }
connect \fault_latched \call_fault [0]
connect \fault_type_latched \fault_type [3:0]
connect \nia_set \call_complete [0]
connect \nia_value 32'00000000000000000000000000000000
connect \mask { 1'0 \port$1565$0 [14:0] }
connect \port$874$0 $1 [2:0]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \b_clear_wr_data.word0_gt \cr_wr_data [31:0]
connect \b_clear_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \b_clear_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \b_clear_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \b_clear_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \b_clear_wr_data.word1_location \cr_wr_data [63:32]
connect \b_clear_wr_data.word2_limit \cr_wr_data [95:64]
connect \b_clear_wr_data.word3_seals \cr_wr_data [127:96]
connect \b_cr_data.word0_gt \b_cr_data [31:0]
connect \b_cr_data.word0_gt.gt_type \b_cr_data [1:0]
connect \b_cr_data.word0_gt.perms \b_cr_data [7:2]
connect \b_cr_data.word0_gt.index \b_cr_data [24:8]
connect \b_cr_data.word0_gt.version \b_cr_data [31:25]
connect \b_cr_data.word1_location \b_cr_data [63:32]
connect \b_cr_data.word2_limit \b_cr_data [95:64]
connect \b_cr_data.word3_seals \b_cr_data [127:96]
connect \src_reg_latched.word0_gt \src_reg_latched [31:0]
connect \src_reg_latched.word0_gt.gt_type \src_reg_latched [1:0]
connect \src_reg_latched.word0_gt.perms \src_reg_latched [7:2]
connect \src_reg_latched.word0_gt.index \src_reg_latched [24:8]
connect \src_reg_latched.word0_gt.version \src_reg_latched [31:25]
connect \src_reg_latched.word1_location \src_reg_latched [63:32]
connect \src_reg_latched.word2_limit \src_reg_latched [95:64]
connect \src_reg_latched.word3_seals \src_reg_latched [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/ret.py:44"
module \top.core.u_return

  attribute \src "/home/runner/workspace/church_machine/ret.py:51"
  wire width 1 \is_null_cap

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \return_cap

  attribute \src "/home/runner/workspace/church_machine/ret.py:62"
  attribute \init 2'00
  wire width 2 \phase

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  attribute \init 1'0
  wire width 1 \sub_start_reg

  attribute \src "/home/runner/workspace/church_machine/ret.py:28"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/ret.py:29"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/ret.py:30"
  wire width 17 \mload_index

  attribute \src "/home/runner/workspace/church_machine/ret.py:31"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/ret.py:33"
  wire width 1 \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/ret.py:32"
  wire width 32 \mload_direct_gt$12

  attribute \src "/home/runner/workspace/church_machine/ret.py:20"
  wire width 4 \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/ret.py:71"
  wire width 4 \local_cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 128 \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 128 \local_cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:22"
  wire width 1 \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/ret.py:70"
  wire width 1 \local_cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/ret.py:69"
  wire width 1 \local_cr_rd_en

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \ret_state

  attribute \src "/home/runner/workspace/church_machine/ret.py:13"
  wire width 1 \complete

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  attribute \init 1'0
  wire width 1 \fault_flag

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  attribute \init 4'0000
  wire width 4 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/ret.py:66"
  attribute \init 1'0
  wire width 1 \sub_done_latched

  attribute \src "/home/runner/workspace/church_machine/ret.py:67"
  attribute \init 1'0
  wire width 1 \sub_fault_latched

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/ret.py:10"
  wire width 1 input 2  \return_start

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 128 input 3  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/ret.py:18"
  wire width 4 output 4  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/ret.py:12"
  wire width 1 output 5  \busy

  attribute \src "/home/runner/workspace/church_machine/ret.py:16"
  wire width 1 output 6  \reboot_request

  attribute \src "/home/runner/workspace/church_machine/ret.py:36"
  wire width 1 input 7  \mload_fault

  attribute \src "/home/runner/workspace/church_machine/ret.py:35"
  wire width 1 input 8  \mload_done

  attribute \src "/home/runner/workspace/church_machine/ret.py:39"
  wire width 1 input 9  \lambda_active

  attribute \src "/home/runner/workspace/church_machine/ret.py:40"
  wire width 32 input 10  \lambda_pc

  attribute \src "/home/runner/workspace/church_machine/ret.py:29"
  wire width 4 output 11  \mload_dst

  attribute \src "/home/runner/workspace/church_machine/ret.py:32"
  wire width 32 output 12  \mload_direct_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:24"
  wire width 1 output 13  \nia_set

  attribute \src "/home/runner/workspace/church_machine/ret.py:25"
  wire width 32 output 14  \nia_value

  attribute \src "/home/runner/workspace/church_machine/ret.py:41"
  wire width 1 output 15  \lambda_clear

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  attribute \init 1'0
  wire width 1 output 16  \fault_valid

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  attribute \init 4'0000
  wire width 4 output 17  \fault_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  attribute \init 1'0
  wire width 1 output 18  \mload_start

  attribute \src "/home/runner/workspace/church_machine/ret.py:37"
  wire width 4 input 19  \mload_fault_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:11"
  wire width 3 input 20  \cr_src

  wire width 33 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 4 $15

  wire width 2 $16

  wire width 1 $17

  wire width 1 $18

  wire width 4 $19

  wire width 128 $20

  wire width 1 $21

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 2 \return_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 6 \return_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 17 \return_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 7 \return_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  wire width 32 \return_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:21"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 2 \local_cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 6 \local_cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 17 \local_cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 7 \local_cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:72"
  wire width 32 \local_cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/ret.py:19"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/ret.py:52"
  cell $eq $22
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \return_cap [1:0]
    connect \B 2'10
    connect \Y \is_null_cap
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:105"
  cell $mux $23
    parameter \WIDTH 4
    connect \S \local_cr_rd_en [0]
    connect \A 4'0000
    connect \B { 1'0 \cr_src [2:0] }
    connect \Y \cr_rd_addr
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:181"
  cell $add $24
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A \return_cap [63:32]
    connect \B 3'100
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:195"
  cell $not $25
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $2 [0]
    connect \Y \busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $26
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B {  }
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $27
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 1'1
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $28
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 2'10
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $29
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 2'11
    connect \Y \complete
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'100
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'101
    connect \Y \reboot_request
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $32
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'110
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 3'111
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1000
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1001
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1010
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \ret_state [3:0]
    connect \B 4'1011
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:134"
  cell $not $38
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \return_cap [7]
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:141"
  cell $not $39
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \return_cap [71]
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:74"
  process $40
    assign \mload_dst [3:0] 4'0000
    switch \phase [1:0]
      case 2'01
        assign \mload_dst [3:0] 4'0110
      case
        assign \mload_dst [3:0] 4'0111
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:75"
  process $41
    assign \mload_direct_gt [31:0] 32'00000000000000000000000000000000
    switch \phase [1:0]
      case 2'01
        assign \mload_direct_gt [31:0] \return_cap [95:64]
      case
        assign \mload_direct_gt [31:0] \return_cap [127:96]
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:24"
  process $42
    assign \nia_set [0] 1'0
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
        assign \nia_set [0] 1'1
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
        assign \nia_set [0] 1'1
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:25"
  process $43
    assign \nia_value [31:0] 32'00000000000000000000000000000000
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
        assign \nia_value [31:0] \lambda_pc [31:0]
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
        assign \nia_value [31:0] $1 [31:0]
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:41"
  process $44
    assign \lambda_clear [0] 1'0
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
        assign \lambda_clear [0] 1'1
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:69"
  process $45
    assign \local_cr_rd_en [0] 1'0
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
        assign \local_cr_rd_en [0] 1'1
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  process $46
    assign $14 [0] \fault_valid [0]
    switch \ret_state [3:0]
      case 4'0000
        assign $14 [0] 1'0
      case 4'0001
      case 4'0010
      case 4'0100
        switch { $12 [0] \is_null_cap [0] }
          case 2'-1
          case 2'1-
            assign $14 [0] 1'1
          case
        end
      case 4'0111
        switch $13 [0]
          case 1'1
            assign $14 [0] 1'1
          case
        end
      case 4'1000
        switch \mload_fault [0]
          case 1'1
            assign $14 [0] 1'1
        end
      case 4'1001
      case 4'1010
        switch \mload_fault [0]
          case 1'1
            assign $14 [0] 1'1
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $14 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:63"
  cell $dff $47
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $14 [0]
    connect \CLK \clk [0]
    connect \Q \fault_valid
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  process $48
    assign $15 [3:0] \fault_type [3:0]
    switch \ret_state [3:0]
      case 4'0000
        assign $15 [3:0] 4'0000
      case 4'0001
      case 4'0010
      case 4'0100
        switch { $12 [0] \is_null_cap [0] }
          case 2'-1
          case 2'1-
            assign $15 [3:0] 4'0110
          case
        end
      case 4'0111
        switch $13 [0]
          case 1'1
            assign $15 [3:0] 4'0110
          case
        end
      case 4'1000
        switch \mload_fault [0]
          case 1'1
            assign $15 [3:0] \mload_fault_type [3:0]
        end
      case 4'1001
      case 4'1010
        switch \mload_fault [0]
          case 1'1
            assign $15 [3:0] \mload_fault_type [3:0]
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $15 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:64"
  cell $dff $49
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $15 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:62"
  process $50
    assign $16 [1:0] \phase [1:0]
    switch \ret_state [3:0]
      case 4'0000
        assign $16 [1:0] 2'01
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
        assign $16 [1:0] 2'10
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $16 [1:0] 2'00
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:62"
  cell $dff $51
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $16 [1:0]
    connect \CLK \clk [0]
    connect \Q \phase
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:66"
  process $52
    assign $17 [0] \sub_done_latched [0]
    switch \ret_state [3:0]
      case 4'0000
        assign $17 [0] 1'0
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
        switch $13 [0]
          case 1'1
          case
            assign $17 [0] 1'0
        end
      case 4'1000
        switch \mload_done [0]
          case 1'1
            assign $17 [0] 1'1
        end
      case 4'1001
        assign $17 [0] 1'0
      case 4'1010
        switch \mload_done [0]
          case 1'1
            assign $17 [0] 1'1
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $17 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:66"
  cell $dff $53
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $17 [0]
    connect \CLK \clk [0]
    connect \Q \sub_done_latched
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:67"
  process $54
    assign $18 [0] \sub_fault_latched [0]
    switch \ret_state [3:0]
      case 4'0000
        assign $18 [0] 1'0
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
        switch $13 [0]
          case 1'1
          case
            assign $18 [0] 1'0
        end
      case 4'1000
        switch \mload_fault [0]
          case 1'1
            assign $18 [0] 1'1
        end
      case 4'1001
        assign $18 [0] 1'0
      case 4'1010
        switch \mload_fault [0]
          case 1'1
            assign $18 [0] 1'1
        end
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $18 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:67"
  cell $dff $55
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $18 [0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_latched
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $56
    assign $19 [3:0] \ret_state [3:0]
    switch \ret_state [3:0]
      case 4'0000
        switch \return_start [0]
          case 1'1
            switch \lambda_active [0]
              case 1'1
                assign $19 [3:0] 4'0001
              case
                assign $19 [3:0] 4'0010
            end
        end
      case 4'0001
        assign $19 [3:0] 4'0011
      case 4'0010
        assign $19 [3:0] 4'0100
      case 4'0100
        switch { $12 [0] \is_null_cap [0] }
          case 2'-1
            assign $19 [3:0] 4'0101
          case 2'1-
            assign $19 [3:0] 4'0110
          case
            assign $19 [3:0] 4'0111
        end
      case 4'0111
        switch $13 [0]
          case 1'1
            assign $19 [3:0] 4'0110
          case
            assign $19 [3:0] 4'1000
        end
      case 4'1000
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $19 [3:0] 4'0110
          case 2'1-
            assign $19 [3:0] 4'1001
        end
      case 4'1001
        assign $19 [3:0] 4'1010
      case 4'1010
        switch { \sub_done_latched [0] \sub_fault_latched [0] }
          case 2'-1
            assign $19 [3:0] 4'0110
          case 2'1-
            assign $19 [3:0] 4'1011
        end
      case 4'1011
        assign $19 [3:0] 4'0011
      case 4'0011
        assign $19 [3:0] 4'0000
      case 4'0101
        assign $19 [3:0] 4'0000
      case 4'0110
        assign $19 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $19 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $57
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $19 [3:0]
    connect \CLK \clk [0]
    connect \Q \ret_state
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  process $58
    assign $20 [127:0] \return_cap [127:0]
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
        assign $20 [127:0] \cr_rd_data [127:0]
      case 4'0100
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $20 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:46"
  cell $dff $59
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $20 [127:0]
    connect \CLK \clk [0]
    connect \Q \return_cap
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  process $60
    assign $21 [0] \mload_start [0]
    switch \ret_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0100
      case 4'0111
        switch $13 [0]
          case 1'1
          case
            assign $21 [0] 1'1
        end
      case 4'1000
        assign $21 [0] 1'0
      case 4'1001
        assign $21 [0] 1'1
      case 4'1010
        assign $21 [0] 1'0
      case 4'1011
      case 4'0011
      case 4'0101
      case 4'0110
    end
    switch \rst [0]
      case 1'1
        assign $21 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/ret.py:65"
  cell $dff $61
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $21 [0]
    connect \CLK \clk [0]
    connect \Q \mload_start
  end

connect \sub_start_reg \mload_start [0]
connect \mload_cr_src 4'0000
connect \mload_cr_dst \mload_dst [3:0]
connect \mload_index 17'00000000000000000
connect \mload_direct 1'1
connect \mload_m_elevated 1'1
connect \mload_direct_gt$12 \mload_direct_gt [31:0]
connect \cr_wr_addr 4'0000
connect \local_cr_wr_addr 4'0000
connect \cr_wr_data 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \local_cr_wr_data 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
connect \cr_wr_en 1'0
connect \local_cr_wr_en 1'0
connect \fault_flag \fault_valid [0]
connect \fault_latched \fault_type [3:0]
connect \return_cap.word0_gt \return_cap [31:0]
connect \return_cap.word0_gt.gt_type \return_cap [1:0]
connect \return_cap.word0_gt.perms \return_cap [7:2]
connect \return_cap.word0_gt.index \return_cap [24:8]
connect \return_cap.word0_gt.version \return_cap [31:25]
connect \return_cap.word1_location \return_cap [63:32]
connect \return_cap.word2_limit \return_cap [95:64]
connect \return_cap.word3_seals \return_cap [127:96]
connect \cr_wr_data.word0_gt 32'00000000000000000000000000000000
connect \cr_wr_data.word0_gt.gt_type 2'00
connect \cr_wr_data.word0_gt.perms 6'000000
connect \cr_wr_data.word0_gt.index 17'00000000000000000
connect \cr_wr_data.word0_gt.version 7'0000000
connect \cr_wr_data.word1_location 32'00000000000000000000000000000000
connect \cr_wr_data.word2_limit 32'00000000000000000000000000000000
connect \cr_wr_data.word3_seals 32'00000000000000000000000000000000
connect \local_cr_wr_data.word0_gt 32'00000000000000000000000000000000
connect \local_cr_wr_data.word0_gt.gt_type 2'00
connect \local_cr_wr_data.word0_gt.perms 6'000000
connect \local_cr_wr_data.word0_gt.index 17'00000000000000000
connect \local_cr_wr_data.word0_gt.version 7'0000000
connect \local_cr_wr_data.word1_location 32'00000000000000000000000000000000
connect \local_cr_wr_data.word2_limit 32'00000000000000000000000000000000
connect \local_cr_wr_data.word3_seals 32'00000000000000000000000000000000
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/tperm.py:27"
module \top.core.u_tperm

  attribute \src "/home/runner/workspace/church_machine/tperm.py:32"
  attribute \init 4'0000
  wire width 4 \preset_reg

  attribute \src "/home/runner/workspace/church_machine/tperm.py:36"
  wire width 6 \new_perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:37"
  wire width 1 \is_reserved

  attribute \src "/home/runner/workspace/church_machine/tperm.py:63"
  wire width 1 \can_only_reduce

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \target_cap

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \tperm_state

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 128 \result_cap

  attribute \src "/home/runner/workspace/church_machine/tperm.py:15"
  wire width 1 \tperm_complete

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  attribute \init 1'0
  wire width 1 \fault_flag

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  attribute \init 4'0000
  wire width 4 \fault_latched

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/tperm.py:10"
  wire width 1 input 2  \tperm_start

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 128 input 3  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/tperm.py:14"
  wire width 1 output 4  \tperm_busy

  attribute \src "/home/runner/workspace/church_machine/tperm.py:19"
  wire width 4 output 5  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/tperm.py:22"
  wire width 4 output 6  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 128 output 7  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/tperm.py:24"
  wire width 1 output 8  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  attribute \init 1'0
  wire width 1 output 9  \tperm_fault

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  attribute \init 4'0000
  wire width 4 output 10  \fault_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:12"
  wire width 4 input 11  \preset

  attribute \src "/home/runner/workspace/church_machine/tperm.py:11"
  wire width 4 input 12  \cr_target

  wire width 6 $1

  wire width 6 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 1 $8

  wire width 1 $9

  wire width 4 $10

  wire width 4 $11

  wire width 3 $12

  wire width 128 $13

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 2 \target_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 6 \target_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 17 \target_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 7 \target_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  wire width 32 \target_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 2 \result_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 6 \result_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 17 \result_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 7 \result_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  wire width 32 \result_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/tperm.py:20"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/tperm.py:64"
  cell $and $14
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \new_perms [5:0]
    connect \B \target_cap [7:2]
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:64"
  cell $eq $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 1
    connect \A $1 [5:0]
    connect \B \new_perms [5:0]
    connect \Y \can_only_reduce
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:94"
  cell $and $16
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 6
    parameter \B_WIDTH 6
    parameter \Y_WIDTH 6
    connect \A \new_perms [5:0]
    connect \B \target_cap [7:2]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:108"
  cell $not $17
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $3 [0]
    connect \Y \tperm_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $18
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B {  }
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $19
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 1'1
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $20
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 2'10
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $21
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 2'11
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $22
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 3'100
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $23
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \tperm_state [2:0]
    connect \B 3'101
    connect \Y \tperm_complete
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:82"
  cell $not $24
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \can_only_reduce [0]
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:36"
  process $25
    assign \new_perms [5:0] 6'000000
    switch \preset_reg [3:0]
      case 4'0000
        assign \new_perms [5:0] 6'000000
      case 4'0001
        assign \new_perms [5:0] 6'000001
      case 4'0010
        assign \new_perms [5:0] 6'000011
      case 4'0011
        assign \new_perms [5:0] 6'000100
      case 4'0100
        assign \new_perms [5:0] 6'000101
      case 4'0101
        assign \new_perms [5:0] 6'000111
      case 4'0110
        assign \new_perms [5:0] 6'001000
      case 4'0111
        assign \new_perms [5:0] 6'010000
      case 4'1000
        assign \new_perms [5:0] 6'100000
      case 4'1001
        assign \new_perms [5:0] 6'011000
      case
        assign \new_perms [5:0] 6'000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:37"
  process $26
    assign \is_reserved [0] 1'0
    switch \preset_reg [3:0]
      case 4'0000
      case 4'0001
      case 4'0010
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case
        assign \is_reserved [0] 1'1
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:19"
  process $27
    assign \cr_rd_addr [3:0] 4'0000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
        assign \cr_rd_addr [3:0] \cr_target [3:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:89"
  process $28
    assign \result_cap [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \result_cap [127:0] \target_cap [127:0]
        assign \result_cap [7:2] $2 [5:0]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:22"
  process $29
    assign \cr_wr_addr [3:0] 4'0000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \cr_wr_addr [3:0] \cr_target [3:0]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:23"
  process $30
    assign \cr_wr_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \cr_wr_data [127:0] \result_cap [127:0]
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:24"
  process $31
    assign \cr_wr_en [0] 1'0
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'100
        assign \cr_wr_en [0] 1'1
      case 3'101
      case 3'011
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  process $32
    assign $9 [0] \tperm_fault [0]
    switch \tperm_state [2:0]
      case 3'000
        assign $9 [0] 1'0
      case 3'001
      case 3'010
        switch { $8 [0] \is_reserved [0] }
          case 2'-1
            assign $9 [0] 1'1
          case 2'1-
            assign $9 [0] 1'1
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $9 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:33"
  cell $dff $33
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $9 [0]
    connect \CLK \clk [0]
    connect \Q \tperm_fault
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  process $34
    assign $10 [3:0] \fault_type [3:0]
    switch \tperm_state [2:0]
      case 3'000
        assign $10 [3:0] 4'0000
      case 3'001
      case 3'010
        switch { $8 [0] \is_reserved [0] }
          case 2'-1
            assign $10 [3:0] 4'1100
          case 2'1-
            assign $10 [3:0] 4'1101
          case
        end
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $10 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:34"
  cell $dff $35
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $10 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:32"
  process $36
    assign $11 [3:0] \preset_reg [3:0]
    switch \tperm_state [2:0]
      case 3'000
        switch \tperm_start [0]
          case 1'1
            assign $11 [3:0] \preset [3:0]
        end
      case 3'001
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $11 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:32"
  cell $dff $37
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $11 [3:0]
    connect \CLK \clk [0]
    connect \Q \preset_reg
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $38
    assign $12 [2:0] \tperm_state [2:0]
    switch \tperm_state [2:0]
      case 3'000
        switch \tperm_start [0]
          case 1'1
            assign $12 [2:0] 3'001
        end
      case 3'001
        assign $12 [2:0] 3'010
      case 3'010
        switch { $8 [0] \is_reserved [0] }
          case 2'-1
            assign $12 [2:0] 3'011
          case 2'1-
            assign $12 [2:0] 3'011
          case
            assign $12 [2:0] 3'100
        end
      case 3'100
        assign $12 [2:0] 3'101
      case 3'101
        assign $12 [2:0] 3'000
      case 3'011
        assign $12 [2:0] 3'000
    end
    switch \rst [0]
      case 1'1
        assign $12 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $39
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $12 [2:0]
    connect \CLK \clk [0]
    connect \Q \tperm_state
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  process $40
    assign $13 [127:0] \target_cap [127:0]
    switch \tperm_state [2:0]
      case 3'000
      case 3'001
        assign $13 [127:0] \cr_rd_data [127:0]
      case 3'010
      case 3'100
      case 3'101
      case 3'011
    end
    switch \rst [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/tperm.py:29"
  cell $dff $41
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $13 [127:0]
    connect \CLK \clk [0]
    connect \Q \target_cap
  end

connect \fault_flag \tperm_fault [0]
connect \fault_latched \fault_type [3:0]
connect \target_cap.word0_gt \target_cap [31:0]
connect \target_cap.word0_gt.gt_type \target_cap [1:0]
connect \target_cap.word0_gt.perms \target_cap [7:2]
connect \target_cap.word0_gt.index \target_cap [24:8]
connect \target_cap.word0_gt.version \target_cap [31:25]
connect \target_cap.word1_location \target_cap [63:32]
connect \target_cap.word2_limit \target_cap [95:64]
connect \target_cap.word3_seals \target_cap [127:96]
connect \result_cap.word0_gt \result_cap [31:0]
connect \result_cap.word0_gt.gt_type \result_cap [1:0]
connect \result_cap.word0_gt.perms \result_cap [7:2]
connect \result_cap.word0_gt.index \result_cap [24:8]
connect \result_cap.word0_gt.version \result_cap [31:25]
connect \result_cap.word1_location \result_cap [63:32]
connect \result_cap.word2_limit \result_cap [95:64]
connect \result_cap.word3_seals \result_cap [127:96]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/save.py:36"
module \top.core.u_save

  attribute \src "/home/runner/workspace/church_machine/save.py:52"
  wire width 1 \dst_in_range

  attribute \src "/home/runner/workspace/church_machine/save.py:13"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/msave.py:12"
  attribute \init 1'0
  wire width 1 \sub_start

  attribute \src "/home/runner/workspace/church_machine/save.py:47"
  attribute \init 1'0
  wire width 1 \sub_start$3

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \sub_dst_cap

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \dst_reg_latched

  attribute \src "/home/runner/workspace/church_machine/msave.py:14"
  wire width 32 \sub_src_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \src_reg_latched

  attribute \src "/home/runner/workspace/church_machine/msave.py:15"
  wire width 17 \sub_index

  attribute \src "/home/runner/workspace/church_machine/save.py:14"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/msave.py:24"
  wire width 1 \mem_wr_done

  attribute \src "/home/runner/workspace/church_machine/save.py:26"
  wire width 1 \mem_wr_done$11

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 128 \cr15_namespace$13

  attribute \src "/home/runner/workspace/church_machine/msave.py:28"
  wire width 32 \mem_rd_data

  attribute \src "/home/runner/workspace/church_machine/save.py:30"
  wire width 32 \mem_rd_data$15

  attribute \src "/home/runner/workspace/church_machine/msave.py:29"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/save.py:31"
  wire width 1 \mem_rd_valid$17

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  wire width 32 \mem_wr_addr$19

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  wire width 32 \mem_wr_data$21

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  wire width 1 \mem_wr_en$23

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  wire width 32 \mem_rd_addr$25

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  wire width 1 \mem_rd_en$27

  attribute \src "/home/runner/workspace/church_machine/save.py:48"
  attribute \init 1'0
  wire width 1 \sub_start_reg

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 3'000
  wire width 3 \save_wrapper_state

  attribute \src "/home/runner/workspace/church_machine/save.py:12"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/save.py:16"
  wire width 1 \save_complete

  attribute \src "/home/runner/workspace/church_machine/save.py:49"
  attribute \init 1'0
  wire width 1 \sub_done_latched

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  attribute \init 1'0
  wire width 1 \fault_latched

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  attribute \init 4'0000
  wire width 4 \fault_type_latched

  attribute \src "/home/runner/workspace/church_machine/save.py:50"
  attribute \init 1'0
  wire width 1 \sub_fault_latched

  attribute \src "/home/runner/workspace/church_machine/msave.py:17"
  wire width 1 \sub_done

  attribute \src "/home/runner/workspace/church_machine/msave.py:18"
  wire width 1 \sub_fault

  attribute \src "/home/runner/workspace/church_machine/msave.py:19"
  wire width 4 \sub_fault_type

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/save.py:11"
  wire width 1 input 2  \save_start

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 128 input 3  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/save.py:15"
  wire width 1 output 4  \save_busy

  wire width 16 input 5  \port$1202$0

  wire width 16 input 6  \port$1203$0

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 128 input 7  \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/save.py:20"
  wire width 4 output 8  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  attribute \init 1'0
  wire width 1 output 9  \save_fault

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  attribute \init 4'0000
  wire width 4 output 10  \fault_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  wire width 32 output 11  \mem_rd_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  wire width 1 output 12  \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  wire width 1 output 13  \mem_wr_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  wire width 32 output 14  \mem_wr_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  wire width 32 output 15  \mem_wr_data

  wire width 23 input 16  \port$1565$0

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 1 $6

  wire width 1 $7

  wire width 4 $8

  wire width 1 $9

  wire width 1 $10

  wire width 3 $11

  wire width 128 $12

  wire width 128 $13

  wire width 1 $14

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 2 \sub_dst_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 6 \sub_dst_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 17 \sub_dst_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 7 \sub_dst_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 2 \dst_reg_latched.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 6 \dst_reg_latched.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 17 \dst_reg_latched.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 7 \dst_reg_latched.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  wire width 32 \dst_reg_latched.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 2 \src_reg_latched.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 6 \src_reg_latched.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 17 \src_reg_latched.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 7 \src_reg_latched.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  wire width 32 \src_reg_latched.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 2 \cr15_namespace$13.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 6 \cr15_namespace$13.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 17 \cr15_namespace$13.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 7 \cr15_namespace$13.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:33"
  wire width 32 \cr15_namespace$13.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/save.py:21"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/save.py:41"
  cell \top.core.u_save.u_msave \u_msave
    connect \clk \clk [0]
    connect \rst \rst [0]
    connect \sub_fault \sub_fault [0]
    connect \sub_done \sub_done [0]
    connect \port$1202$0 \port$1202$0 [15:0]
    connect \port$1203$0 \port$1203$0 [15:0]
    connect \cr15_namespace \cr15_namespace [127:0]
    connect \sub_dst_cap \sub_dst_cap [127:0]
    connect \sub_src_gt \src_reg_latched [31:0]
    connect \sub_start \sub_start [0]
    connect \mem_rd_addr \mem_rd_addr [31:0]
    connect \mem_rd_en \mem_rd_en [0]
    connect \mem_wr_en \mem_wr_en [0]
    connect \mem_wr_addr \mem_wr_addr [31:0]
    connect \mem_wr_data \mem_wr_data [31:0]
    connect \sub_fault_type \sub_fault_type [3:0]
    connect \port$1565$0 \port$1565$0 [14:0]
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:53"
  cell $le $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \port$1565$0 [22:19]
    connect \B 3'110
    connect \Y \dst_in_range
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:115"
  cell $not $16
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \Y \save_busy
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:116"
  cell $and $17
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $5 [0]
    connect \B \sub_done_latched [0]
    connect \Y \save_complete
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $18
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B {  }
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $19
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 1'1
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $20
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 2'10
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $21
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 2'11
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $22
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 3
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \save_wrapper_state [2:0]
    connect \B 3'100
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:85"
  cell $not $23
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \dst_in_range [0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:20"
  process $24
    assign \cr_rd_addr [3:0] 4'0000
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
        assign \cr_rd_addr [3:0] \port$1565$0 [22:19]
      case 3'010
        assign \cr_rd_addr [3:0] \port$1565$0 [18:15]
      case 3'011
        assign \cr_rd_addr [3:0] \port$1565$0 [18:15]
      case 3'100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  process $25
    assign $7 [0] \save_fault [0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $7 [0] 1'0
      case 3'001
        switch $6 [0]
          case 1'1
            assign $7 [0] 1'1
          case
        end
      case 3'010
      case 3'011
      case 3'100
        switch \sub_fault [0]
          case 1'1
            assign $7 [0] 1'1
        end
    end
    switch \rst [0]
      case 1'1
        assign $7 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:45"
  cell $dff $26
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $7 [0]
    connect \CLK \clk [0]
    connect \Q \save_fault
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  process $27
    assign $8 [3:0] \fault_type [3:0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $8 [3:0] 4'0000
      case 3'001
        switch $6 [0]
          case 1'1
            assign $8 [3:0] 4'0101
          case
        end
      case 3'010
      case 3'011
      case 3'100
        switch \sub_fault [0]
          case 1'1
            assign $8 [3:0] \sub_fault_type [3:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $8 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:46"
  cell $dff $28
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $8 [3:0]
    connect \CLK \clk [0]
    connect \Q \fault_type
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:49"
  process $29
    assign $9 [0] \sub_done_latched [0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $9 [0] 1'0
      case 3'001
      case 3'010
      case 3'011
      case 3'100
        switch \sub_done [0]
          case 1'1
            assign $9 [0] 1'1
        end
    end
    switch \rst [0]
      case 1'1
        assign $9 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:49"
  cell $dff $30
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $9 [0]
    connect \CLK \clk [0]
    connect \Q \sub_done_latched
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:50"
  process $31
    assign $10 [0] \sub_fault_latched [0]
    switch \save_wrapper_state [2:0]
      case 3'000
        assign $10 [0] 1'0
      case 3'001
      case 3'010
      case 3'011
      case 3'100
        switch \sub_fault [0]
          case 1'1
            assign $10 [0] 1'1
        end
    end
    switch \rst [0]
      case 1'1
        assign $10 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:50"
  cell $dff $32
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $10 [0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_latched
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $33
    assign $11 [2:0] \save_wrapper_state [2:0]
    switch \save_wrapper_state [2:0]
      case 3'000
        switch \save_start [0]
          case 1'1
            assign $11 [2:0] 3'001
        end
      case 3'001
        switch $6 [0]
          case 1'1
            assign $11 [2:0] 3'000
          case
            assign $11 [2:0] 3'010
        end
      case 3'010
        assign $11 [2:0] 3'011
      case 3'011
        assign $11 [2:0] 3'100
      case 3'100
        switch { \sub_fault_latched [0] \sub_done_latched [0] }
          case 2'-1
            assign $11 [2:0] 3'000
          case 2'1-
            assign $11 [2:0] 3'000
        end
    end
    switch \rst [0]
      case 1'1
        assign $11 [2:0] 3'000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $34
    parameter \WIDTH 3
    parameter \CLK_POLARITY 1
    connect \D $11 [2:0]
    connect \CLK \clk [0]
    connect \Q \save_wrapper_state
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  process $35
    assign $12 [127:0] \sub_dst_cap [127:0]
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
      case 3'010
        assign $12 [127:0] \cr_rd_data [127:0]
      case 3'011
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $12 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:43"
  cell $dff $36
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $12 [127:0]
    connect \CLK \clk [0]
    connect \Q \sub_dst_cap
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  process $37
    assign $13 [127:0] \src_reg_latched [127:0]
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'011
        assign $13 [127:0] \cr_rd_data [127:0]
      case 3'100
    end
    switch \rst [0]
      case 1'1
        assign $13 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:44"
  cell $dff $38
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $13 [127:0]
    connect \CLK \clk [0]
    connect \Q \src_reg_latched
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:48"
  process $39
    assign $14 [0] \sub_start [0]
    switch \save_wrapper_state [2:0]
      case 3'000
      case 3'001
      case 3'010
      case 3'011
        assign $14 [0] 1'1
      case 3'100
        assign $14 [0] 1'0
    end
    switch \rst [0]
      case 1'1
        assign $14 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/save.py:48"
  cell $dff $40
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $14 [0]
    connect \CLK \clk [0]
    connect \Q \sub_start
  end

connect \cr_dst \port$1565$0 [22:19]
connect \sub_start$3 \sub_start [0]
connect \dst_reg_latched \sub_dst_cap [127:0]
connect \sub_src_gt \src_reg_latched [31:0]
connect \sub_index { 2'00 \port$1565$0 [14:0] }
connect \index { 2'00 \port$1565$0 [14:0] }
connect \mem_wr_done 1'1
connect \mem_wr_done$11 1'1
connect \cr15_namespace$13 \cr15_namespace [127:0]
connect \mem_rd_data { \port$1203$0 [15:0] \port$1202$0 [15:0] }
connect \mem_rd_data$15 { \port$1203$0 [15:0] \port$1202$0 [15:0] }
connect \mem_rd_valid 1'1
connect \mem_rd_valid$17 1'1
connect \mem_wr_addr$19 \mem_wr_addr [31:0]
connect \mem_wr_data$21 \mem_wr_data [31:0]
connect \mem_wr_en$23 \mem_wr_en [0]
connect \mem_rd_addr$25 \mem_rd_addr [31:0]
connect \mem_rd_en$27 \mem_rd_en [0]
connect \sub_start_reg \sub_start [0]
connect \cr_src \port$1565$0 [18:15]
connect \fault_latched \save_fault [0]
connect \fault_type_latched \fault_type [3:0]
connect \sub_dst_cap.word0_gt \sub_dst_cap [31:0]
connect \sub_dst_cap.word0_gt.gt_type \sub_dst_cap [1:0]
connect \sub_dst_cap.word0_gt.perms \sub_dst_cap [7:2]
connect \sub_dst_cap.word0_gt.index \sub_dst_cap [24:8]
connect \sub_dst_cap.word0_gt.version \sub_dst_cap [31:25]
connect \sub_dst_cap.word1_location \sub_dst_cap [63:32]
connect \sub_dst_cap.word2_limit \sub_dst_cap [95:64]
connect \sub_dst_cap.word3_seals \sub_dst_cap [127:96]
connect \dst_reg_latched.word0_gt \sub_dst_cap [31:0]
connect \dst_reg_latched.word0_gt.gt_type \sub_dst_cap [1:0]
connect \dst_reg_latched.word0_gt.perms \sub_dst_cap [7:2]
connect \dst_reg_latched.word0_gt.index \sub_dst_cap [24:8]
connect \dst_reg_latched.word0_gt.version \sub_dst_cap [31:25]
connect \dst_reg_latched.word1_location \sub_dst_cap [63:32]
connect \dst_reg_latched.word2_limit \sub_dst_cap [95:64]
connect \dst_reg_latched.word3_seals \sub_dst_cap [127:96]
connect \src_reg_latched.word0_gt \src_reg_latched [31:0]
connect \src_reg_latched.word0_gt.gt_type \src_reg_latched [1:0]
connect \src_reg_latched.word0_gt.perms \src_reg_latched [7:2]
connect \src_reg_latched.word0_gt.index \src_reg_latched [24:8]
connect \src_reg_latched.word0_gt.version \src_reg_latched [31:25]
connect \src_reg_latched.word1_location \src_reg_latched [63:32]
connect \src_reg_latched.word2_limit \src_reg_latched [95:64]
connect \src_reg_latched.word3_seals \src_reg_latched [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \cr15_namespace$13.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace$13.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace$13.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace$13.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace$13.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace$13.word1_location \cr15_namespace [63:32]
connect \cr15_namespace$13.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace$13.word3_seals \cr15_namespace [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/msave.py:34"
module \top.core.u_save.u_msave

  attribute \src "/home/runner/workspace/church_machine/msave.py:50"
  wire width 1 \index_in_bounds

  attribute \src "/home/runner/workspace/church_machine/msave.py:38"
  attribute \init 17'00000000000000000
  wire width 17 \index_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \dst_cap_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:53"
  wire width 32 \write_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:56"
  wire width 32 \ns_entry_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:37"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \src_gt_reg

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \msave_state

  attribute \src "/home/runner/workspace/church_machine/msave.py:16"
  wire width 1 \sub_busy

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  attribute \init 4'0000
  wire width 4 \fault_type_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:15"
  wire width 17 \sub_index

  attribute \src "/home/runner/workspace/church_machine/msave.py:29"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/msave.py:59"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \ns_location_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:28"
  wire width 32 \mem_rd_data

  attribute \src "/home/runner/workspace/church_machine/msave.py:60"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \ns_limit_reg

  attribute \src "/home/runner/workspace/church_machine/msave.py:24"
  wire width 1 \mem_wr_done

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/msave.py:18"
  wire width 1 output 2  \sub_fault

  attribute \src "/home/runner/workspace/church_machine/msave.py:17"
  wire width 1 output 3  \sub_done

  wire width 16 input 4  \port$1202$0

  wire width 16 input 5  \port$1203$0

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 128 input 6  \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 128 input 7  \sub_dst_cap

  attribute \src "/home/runner/workspace/church_machine/msave.py:14"
  wire width 32 input 8  \sub_src_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:12"
  wire width 1 input 9  \sub_start

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  wire width 32 output 10  \mem_rd_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  wire width 1 output 11  \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  wire width 1 output 12  \mem_wr_en

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  wire width 32 output 13  \mem_wr_addr

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  wire width 32 output 14  \mem_wr_data

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  attribute \init 4'0000
  wire width 4 output 15  \sub_fault_type

  wire width 15 input 16  \port$1565$0

  wire width 20 $1

  wire width 33 $2

  wire width 20 $3

  wire width 33 $4

  wire width 20 $5

  wire width 34 $6

  wire width 33 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 128 $19

  wire width 32 $20

  wire width 17 $21

  wire width 4 $22

  wire width 4 $23

  wire width 32 $24

  wire width 32 $25

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 2 \dst_cap_reg.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 6 \dst_cap_reg.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 17 \dst_cap_reg.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 7 \dst_cap_reg.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  wire width 32 \dst_cap_reg.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:31"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 2 \sub_dst_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 6 \sub_dst_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 17 \sub_dst_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 7 \sub_dst_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/msave.py:13"
  wire width 32 \sub_dst_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/msave.py:51"
  cell $lt $26
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 17
    parameter \Y_WIDTH 1
    connect \A \index_reg [16:0]
    connect \B \dst_cap_reg [80:64]
    connect \Y \index_in_bounds
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:54"
  cell $shl $27
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \index_reg [16:0]
    connect \B 2'10
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:54"
  cell $add $28
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \dst_cap_reg [63:32]
    connect \B $1 [19:0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $shl $29
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \src_gt_reg [24:8]
    connect \B 2'11
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $add $30
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \cr15_namespace [63:32]
    connect \B $3 [19:0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $shl $31
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \src_gt_reg [24:8]
    connect \B 2'10
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:57"
  cell $add $32
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 33
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 34
    connect \A $4 [32:0]
    connect \B $5 [19:0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:134"
  cell $add $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A $6 [31:0]
    connect \B 3'100
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:187"
  cell $not $34
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $8 [0]
    connect \Y \sub_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B {  }
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 1'1
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 2'10
    connect \Y \sub_fault
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 2'11
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $39
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'100
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $40
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'101
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $41
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'110
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 3'111
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 4'1000
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $44
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \msave_state [3:0]
    connect \B 4'1001
    connect \Y \sub_done
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:103"
  cell $not $45
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \dst_cap_reg [95]
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:110"
  cell $not $46
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \dst_cap_reg [6]
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:117"
  cell $not $47
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \index_in_bounds [0]
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:26"
  process $48
    assign \mem_rd_addr [31:0] 32'00000000000000000000000000000000
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        assign \mem_rd_addr [31:0] $6 [31:0]
      case 4'0110
        assign \mem_rd_addr [31:0] $7 [31:0]
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:27"
  process $49
    assign \mem_rd_en [0] 1'0
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        assign \mem_rd_en [0] 1'1
      case 4'0110
        assign \mem_rd_en [0] 1'1
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:23"
  process $50
    assign \mem_wr_en [0] 1'0
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign \mem_wr_en [0] 1'1
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:21"
  process $51
    assign \mem_wr_addr [31:0] 32'00000000000000000000000000000000
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign \mem_wr_addr [31:0] $2 [31:0]
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:22"
  process $52
    assign \mem_wr_data [31:0] 32'00000000000000000000000000000000
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
        assign \mem_wr_data [31:0] \src_gt_reg [31:0]
      case 4'1001
      case 4'0010
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  process $53
    assign $19 [127:0] \dst_cap_reg [127:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $19 [127:0] \sub_dst_cap [127:0]
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $19 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:36"
  cell $dff $54
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $19 [127:0]
    connect \CLK \clk [0]
    connect \Q \dst_cap_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:37"
  process $55
    assign $20 [31:0] \src_gt_reg [31:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $20 [31:0] \sub_src_gt [31:0]
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $20 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:37"
  cell $dff $56
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $20 [31:0]
    connect \CLK \clk [0]
    connect \Q \src_gt_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:38"
  process $57
    assign $21 [16:0] \index_reg [16:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $21 [16:0] { 2'00 \port$1565$0 [14:0] }
        end
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $21 [16:0] 17'00000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:38"
  cell $dff $58
    parameter \WIDTH 17
    parameter \CLK_POLARITY 1
    connect \D $21 [16:0]
    connect \CLK \clk [0]
    connect \Q \index_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  process $59
    assign $22 [3:0] \sub_fault_type [3:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $22 [3:0] 4'0000
        end
      case 4'0001
        switch $16 [0]
          case 1'1
            assign $22 [3:0] 4'1110
          case
        end
      case 4'0011
        switch $17 [0]
          case 1'1
            assign $22 [3:0] 4'0101
          case
        end
      case 4'0100
        switch $18 [0]
          case 1'1
            assign $22 [3:0] 4'1000
          case
        end
      case 4'0101
      case 4'0110
      case 4'0111
        switch \ns_limit_reg [30]
          case 1'1
            assign $22 [3:0] 4'1111
          case
        end
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $22 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:39"
  cell $dff $60
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $22 [3:0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_type
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $61
    assign $23 [3:0] \msave_state [3:0]
    switch \msave_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $23 [3:0] 4'0001
        end
      case 4'0001
        switch $16 [0]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'0011
        end
      case 4'0011
        switch $17 [0]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'0100
        end
      case 4'0100
        switch $18 [0]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'0101
        end
      case 4'0101
        switch 1'1
          case 1'1
            assign $23 [3:0] 4'0110
        end
      case 4'0110
        switch 1'1
          case 1'1
            assign $23 [3:0] 4'0111
        end
      case 4'0111
        switch \ns_limit_reg [30]
          case 1'1
            assign $23 [3:0] 4'0010
          case
            assign $23 [3:0] 4'1000
        end
      case 4'1000
        switch 1'1
          case 1'1
            assign $23 [3:0] 4'1001
        end
      case 4'1001
        assign $23 [3:0] 4'0000
      case 4'0010
        assign $23 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $23 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $62
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $23 [3:0]
    connect \CLK \clk [0]
    connect \Q \msave_state
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:59"
  process $63
    assign $24 [31:0] \ns_location_reg [31:0]
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
        switch 1'1
          case 1'1
            assign $24 [31:0] { \port$1203$0 [15:0] \port$1202$0 [15:0] }
        end
      case 4'0110
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $24 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:59"
  cell $dff $64
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $24 [31:0]
    connect \CLK \clk [0]
    connect \Q \ns_location_reg
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:60"
  process $65
    assign $25 [31:0] \ns_limit_reg [31:0]
    switch \msave_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0100
      case 4'0101
      case 4'0110
        switch 1'1
          case 1'1
            assign $25 [31:0] { \port$1203$0 [15:0] \port$1202$0 [15:0] }
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'0010
    end
    switch \rst [0]
      case 1'1
        assign $25 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/msave.py:60"
  cell $dff $66
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $25 [31:0]
    connect \CLK \clk [0]
    connect \Q \ns_limit_reg
  end

connect \write_addr $2 [31:0]
connect \ns_entry_addr $6 [31:0]
connect \fault_type_reg \sub_fault_type [3:0]
connect \sub_index { 2'00 \port$1565$0 [14:0] }
connect \mem_rd_valid 1'1
connect \mem_rd_data { \port$1203$0 [15:0] \port$1202$0 [15:0] }
connect \mem_wr_done 1'1
connect \dst_cap_reg.word0_gt \dst_cap_reg [31:0]
connect \dst_cap_reg.word0_gt.gt_type \dst_cap_reg [1:0]
connect \dst_cap_reg.word0_gt.perms \dst_cap_reg [7:2]
connect \dst_cap_reg.word0_gt.index \dst_cap_reg [24:8]
connect \dst_cap_reg.word0_gt.version \dst_cap_reg [31:25]
connect \dst_cap_reg.word1_location \dst_cap_reg [63:32]
connect \dst_cap_reg.word2_limit \dst_cap_reg [95:64]
connect \dst_cap_reg.word3_seals \dst_cap_reg [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \sub_dst_cap.word0_gt \sub_dst_cap [31:0]
connect \sub_dst_cap.word0_gt.gt_type \sub_dst_cap [1:0]
connect \sub_dst_cap.word0_gt.perms \sub_dst_cap [7:2]
connect \sub_dst_cap.word0_gt.index \sub_dst_cap [24:8]
connect \sub_dst_cap.word0_gt.version \sub_dst_cap [31:25]
connect \sub_dst_cap.word1_location \sub_dst_cap [63:32]
connect \sub_dst_cap.word2_limit \sub_dst_cap [95:64]
connect \sub_dst_cap.word3_seals \sub_dst_cap [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/load.py:31"
module \top.core.u_load

  attribute \src "/home/runner/workspace/church_machine/load.py:18"
  wire width 4 \mload_cr_src

  attribute \src "/home/runner/workspace/church_machine/load.py:9"
  wire width 4 \cr_src

  attribute \src "/home/runner/workspace/church_machine/load.py:19"
  wire width 4 \mload_cr_dst

  attribute \src "/home/runner/workspace/church_machine/load.py:10"
  wire width 4 \cr_dst

  attribute \src "/home/runner/workspace/church_machine/load.py:20"
  wire width 17 \mload_index

  attribute \src "/home/runner/workspace/church_machine/load.py:11"
  wire width 17 \index

  attribute \src "/home/runner/workspace/church_machine/load.py:21"
  wire width 1 \mload_direct

  attribute \src "/home/runner/workspace/church_machine/load.py:22"
  wire width 32 \mload_direct_gt

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 2'00
  wire width 2 \load_wrapper_state

  attribute \src "/home/runner/workspace/church_machine/load.py:13"
  wire width 1 \load_complete

  attribute \src "/home/runner/workspace/church_machine/load.py:28"
  wire width 4 \mload_fault_type

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/load.py:8"
  wire width 1 input 2  \load_start

  attribute \src "/home/runner/workspace/church_machine/load.py:23"
  wire width 1 output 3  \mload_m_elevated

  attribute \src "/home/runner/workspace/church_machine/load.py:12"
  wire width 1 output 4  \load_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:14"
  wire width 1 output 5  \load_fault

  attribute \src "/home/runner/workspace/church_machine/load.py:25"
  wire width 1 input 6  \mload_busy

  attribute \src "/home/runner/workspace/church_machine/load.py:27"
  wire width 1 input 7  \mload_fault

  attribute \src "/home/runner/workspace/church_machine/load.py:26"
  wire width 1 input 8  \mload_done

  attribute \src "/home/runner/workspace/church_machine/load.py:17"
  wire width 1 output 9  \mload_start

  attribute \src "/home/runner/workspace/church_machine/load.py:28"
  wire width 4 input 10  \fault_type

  wire width 23 input 11  \port$1565$0

  wire width 1 $1

  wire width 1 $2

  wire width 1 $3

  wire width 1 $4

  wire width 1 $5

  wire width 2 $6

  attribute \src "/home/runner/workspace/church_machine/load.py:39"
  cell $eq $7
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \port$1565$0 [18:15]
    connect \B 3'110
    connect \Y \mload_m_elevated
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:58"
  cell $not $8
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $1 [0]
    connect \Y \load_busy
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:59"
  cell $and $9
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $4 [0]
    connect \B \mload_done [0]
    connect \Y \load_complete
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:60"
  cell $and $10
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $4 [0]
    connect \B \mload_fault [0]
    connect \Y \load_fault
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $11
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B {  }
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $12
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B 1'1
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $13
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B 2'10
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $14
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \load_wrapper_state [1:0]
    connect \B 2'11
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:54"
  cell $or $15
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \mload_done [0]
    connect \B \mload_fault [0]
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/load.py:17"
  process $16
    assign \mload_start [0] 1'0
    switch \load_wrapper_state [1:0]
      case 2'00
      case 2'01
        assign \mload_start [0] 1'1
      case 2'10
        assign \mload_start [0] 1'1
      case 2'11
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $17
    assign $6 [1:0] \load_wrapper_state [1:0]
    switch \load_wrapper_state [1:0]
      case 2'00
        switch \load_start [0]
          case 1'1
            assign $6 [1:0] 2'01
        end
      case 2'01
        assign $6 [1:0] 2'10
      case 2'10
        switch \mload_busy [0]
          case 1'1
            assign $6 [1:0] 2'11
        end
      case 2'11
        switch $5 [0]
          case 1'1
            assign $6 [1:0] 2'00
        end
    end
    switch \rst [0]
      case 1'1
        assign $6 [1:0] 2'00
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $18
    parameter \WIDTH 2
    parameter \CLK_POLARITY 1
    connect \D $6 [1:0]
    connect \CLK \clk [0]
    connect \Q \load_wrapper_state
  end

connect \mload_cr_src \port$1565$0 [18:15]
connect \cr_src \port$1565$0 [18:15]
connect \mload_cr_dst \port$1565$0 [22:19]
connect \cr_dst \port$1565$0 [22:19]
connect \mload_index { 2'00 \port$1565$0 [14:0] }
connect \index { 2'00 \port$1565$0 [14:0] }
connect \mload_direct 1'0
connect \mload_direct_gt 32'00000000000000000000000000000000
connect \mload_fault_type \fault_type [3:0]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/mload.py:51"
module \top.core.u_shared_mload

  attribute \src "/home/runner/workspace/church_machine/mload.py:70"
  wire width 1 \src_is_null

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \src_cap

  attribute \src "/home/runner/workspace/church_machine/mload.py:73"
  wire width 1 \bounds_ok

  attribute \src "/home/runner/workspace/church_machine/mload.py:55"
  attribute \init 17'00000000000000000
  wire width 17 \index_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:76"
  wire width 32 \clist_gt_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:79"
  wire width 32 \ns_entry_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  attribute \init 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
  wire width 128 \result_cap

  attribute \src "/home/runner/workspace/church_machine/mload.py:82"
  wire width 1 \ns_index_in_bounds

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  attribute \init 4'0000
  wire width 4 \mload_state

  attribute \src "/home/runner/workspace/church_machine/mload.py:56"
  attribute \init 1'0
  wire width 1 \direct_mode

  attribute \src "/home/runner/workspace/church_machine/mload.py:53"
  attribute \init 4'0000
  wire width 4 \cr_src_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:54"
  attribute \init 4'0000
  wire width 4 \cr_dst_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:43"
  wire width 1 \thread_wr_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:44"
  wire width 4 \thread_wr_idx

  attribute \src "/home/runner/workspace/church_machine/mload.py:45"
  wire width 32 \thread_wr_data

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  attribute \init 4'0000
  wire width 4 \fault_type_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:57"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \direct_gt_reg

  attribute \src "/home/runner/workspace/church_machine/mload.py:36"
  wire width 1 \mem_rd_valid

  attribute \src "/home/runner/workspace/church_machine/mload.py:35"
  wire width 32 \mem_rd_data

  attribute \src "/home/runner/workspace/church_machine/mload.py:85"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 \ns_w1_saved

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 128 input 2  \cr_rd_data

  attribute \src "/home/runner/workspace/church_machine/mload.py:19"
  wire width 1 output 3  \sub_busy

  attribute \src "/home/runner/workspace/church_machine/mload.py:21"
  wire width 1 output 4  \sub_fault

  attribute \src "/home/runner/workspace/church_machine/mload.py:20"
  wire width 1 output 5  \sub_done

  wire width 16 input 6  \port$1202$0

  wire width 16 input 7  \port$1203$0

  attribute \src "/home/runner/workspace/church_machine/mload.py:12"
  wire width 1 input 8  \sub_start

  attribute \src "/home/runner/workspace/church_machine/mload.py:13"
  wire width 4 input 9  \sub_cr_src

  attribute \src "/home/runner/workspace/church_machine/mload.py:14"
  wire width 4 input 10  \sub_cr_dst

  attribute \src "/home/runner/workspace/church_machine/mload.py:15"
  wire width 17 input 11  \sub_index

  attribute \src "/home/runner/workspace/church_machine/mload.py:16"
  wire width 1 input 12  \sub_direct

  attribute \src "/home/runner/workspace/church_machine/mload.py:17"
  wire width 32 input 13  \sub_direct_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:18"
  wire width 1 input 14  \sub_m_elevated

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 128 input 15  \cr15_namespace

  attribute \src "/home/runner/workspace/church_machine/mload.py:24"
  wire width 4 output 16  \cr_rd_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:33"
  wire width 32 output 17  \mem_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:34"
  wire width 1 output 18  \mem_rd_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:27"
  wire width 4 output 19  \cr_wr_addr

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 128 output 20  \cr_wr_data

  attribute \src "/home/runner/workspace/church_machine/mload.py:29"
  wire width 1 output 21  \cr_wr_en

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  attribute \init 4'0000
  wire width 4 output 22  \sub_fault_type

  wire width 20 $1

  wire width 33 $2

  wire width 20 $3

  wire width 33 $4

  wire width 20 $5

  wire width 34 $6

  wire width 33 $7

  wire width 1 $8

  wire width 1 $9

  wire width 1 $10

  wire width 1 $11

  wire width 1 $12

  wire width 1 $13

  wire width 1 $14

  wire width 1 $15

  wire width 1 $16

  wire width 1 $17

  wire width 1 $18

  wire width 1 $19

  wire width 1 $20

  wire width 1 $21

  wire width 1 $22

  wire width 4 $23

  wire width 4 $24

  wire width 17 $25

  wire width 1 $26

  wire width 32 $27

  wire width 128 $28

  wire width 4 $29

  wire width 4 $30

  wire width 128 $31

  wire width 32 $32

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 2 \src_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 6 \src_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 17 \src_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 7 \src_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  wire width 32 \src_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 2 \cr15_namespace.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 6 \cr15_namespace.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 17 \cr15_namespace.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 7 \cr15_namespace.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:31"
  wire width 32 \cr15_namespace.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 2 \result_cap.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 6 \result_cap.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 17 \result_cap.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 7 \result_cap.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  wire width 32 \result_cap.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 2 \cr_wr_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 6 \cr_wr_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 17 \cr_wr_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 7 \cr_wr_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  wire width 32 \cr_wr_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word0_gt

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 2 \cr_rd_data.word0_gt.gt_type

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 6 \cr_rd_data.word0_gt.perms

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 17 \cr_rd_data.word0_gt.index

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 7 \cr_rd_data.word0_gt.version

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word1_location

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word2_limit

  attribute \src "/home/runner/workspace/church_machine/mload.py:25"
  wire width 32 \cr_rd_data.word3_seals

  attribute \src "/home/runner/workspace/church_machine/mload.py:71"
  cell $eq $33
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 2
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \src_cap [1:0]
    connect \B 2'10
    connect \Y \src_is_null
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:74"
  cell $lt $34
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 17
    parameter \Y_WIDTH 1
    connect \A \index_reg [16:0]
    connect \B \src_cap [80:64]
    connect \Y \bounds_ok
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:77"
  cell $shl $35
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \index_reg [16:0]
    connect \B 2'10
    connect \Y $1
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:77"
  cell $add $36
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \src_cap [63:32]
    connect \B $1 [19:0]
    connect \Y $2
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $shl $37
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \result_cap [24:8]
    connect \B 2'11
    connect \Y $3
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $add $38
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 33
    connect \A \cr15_namespace [63:32]
    connect \B $3 [19:0]
    connect \Y $4
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $shl $39
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 20
    connect \A \result_cap [24:8]
    connect \B 2'10
    connect \Y $5
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:80"
  cell $add $40
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 33
    parameter \B_WIDTH 20
    parameter \Y_WIDTH 34
    connect \A $4 [32:0]
    connect \B $5 [19:0]
    connect \Y $6
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:83"
  cell $lt $41
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 17
    parameter \B_WIDTH 17
    parameter \Y_WIDTH 1
    connect \A \result_cap [24:8]
    connect \B \cr15_namespace [80:64]
    connect \Y \ns_index_in_bounds
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:181"
  cell $add $42
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 32
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 33
    connect \A $6 [31:0]
    connect \B 3'100
    connect \Y $7
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:234"
  cell $le $43
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \cr_dst_reg [3:0]
    connect \B 3'111
    connect \Y $8
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:254"
  cell $not $44
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $9 [0]
    connect \Y \sub_busy
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $45
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 0
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B {  }
    connect \Y $9
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $46
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 1'1
    connect \Y $10
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $47
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 2'10
    connect \Y $11
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $48
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 2
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 2'11
    connect \Y $12
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $49
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'100
    connect \Y \sub_fault
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $50
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'101
    connect \Y $13
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $51
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'110
    connect \Y $14
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $52
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 3
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 3'111
    connect \Y $15
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $53
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 4'1000
    connect \Y $16
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $54
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 4'1001
    connect \Y $17
  end

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_dsl.py:486"
  cell $eq $55
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \mload_state [3:0]
    connect \B 4'1010
    connect \Y \sub_done
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:141"
  cell $not $56
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \src_cap [5]
    connect \Y $18
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:141"
  cell $not $57
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \sub_m_elevated [0]
    connect \Y $19
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:141"
  cell $and $58
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 1
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A $18 [0]
    connect \B $19 [0]
    connect \Y $20
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:148"
  cell $not $59
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \bounds_ok [0]
    connect \Y $21
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:164"
  cell $not $60
    parameter \A_SIGNED 0
    parameter \A_WIDTH 1
    parameter \Y_WIDTH 1
    connect \A \ns_index_in_bounds [0]
    connect \Y $22
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:24"
  process $61
    assign \cr_rd_addr [3:0] 4'0000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
        switch \direct_mode [0]
          case 1'1
          case
            assign \cr_rd_addr [3:0] \cr_src_reg [3:0]
        end
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:33"
  process $62
    assign \mem_addr [31:0] 32'00000000000000000000000000000000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
        assign \mem_addr [31:0] $2 [31:0]
      case 4'0010
      case 4'0111
        assign \mem_addr [31:0] $6 [31:0]
      case 4'1000
        assign \mem_addr [31:0] $7 [31:0]
      case 4'1001
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:34"
  process $63
    assign \mem_rd_en [0] 1'0
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
        assign \mem_rd_en [0] 1'1
      case 4'0010
      case 4'0111
        assign \mem_rd_en [0] 1'1
      case 4'1000
        assign \mem_rd_en [0] 1'1
      case 4'1001
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:43"
  process $64
    assign \thread_wr_en [0] 1'0
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
        switch $8 [0]
          case 1'1
            assign \thread_wr_en [0] 1'1
        end
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:44"
  process $65
    assign \thread_wr_idx [3:0] 4'0000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
        switch $8 [0]
          case 1'1
            assign \thread_wr_idx [3:0] \cr_dst_reg [3:0]
        end
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:45"
  process $66
    assign \thread_wr_data [31:0] 32'00000000000000000000000000000000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
        switch $8 [0]
          case 1'1
            assign \thread_wr_data [31:0] \result_cap [31:0]
        end
      case 4'1010
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:27"
  process $67
    assign \cr_wr_addr [3:0] 4'0000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
        assign \cr_wr_addr [3:0] \cr_dst_reg [3:0]
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:28"
  process $68
    assign \cr_wr_data [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
        assign \cr_wr_data [127:0] \result_cap [127:0]
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:29"
  process $69
    assign \cr_wr_en [0] 1'0
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
        assign \cr_wr_en [0] 1'1
      case 4'0100
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:53"
  process $70
    assign $23 [3:0] \cr_src_reg [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $23 [3:0] \sub_cr_src [3:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $23 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:53"
  cell $dff $71
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $23 [3:0]
    connect \CLK \clk [0]
    connect \Q \cr_src_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:54"
  process $72
    assign $24 [3:0] \cr_dst_reg [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $24 [3:0] \sub_cr_dst [3:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $24 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:54"
  cell $dff $73
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $24 [3:0]
    connect \CLK \clk [0]
    connect \Q \cr_dst_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:55"
  process $74
    assign $25 [16:0] \index_reg [16:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $25 [16:0] \sub_index [16:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $25 [16:0] 17'00000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:55"
  cell $dff $75
    parameter \WIDTH 17
    parameter \CLK_POLARITY 1
    connect \D $25 [16:0]
    connect \CLK \clk [0]
    connect \Q \index_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:56"
  process $76
    assign $26 [0] \direct_mode [0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $26 [0] \sub_direct [0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $26 [0] 1'0
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:56"
  cell $dff $77
    parameter \WIDTH 1
    parameter \CLK_POLARITY 1
    connect \D $26 [0]
    connect \CLK \clk [0]
    connect \Q \direct_mode
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:57"
  process $78
    assign $27 [31:0] \direct_gt_reg [31:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $27 [31:0] \sub_direct_gt [31:0]
        end
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $27 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:57"
  cell $dff $79
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $27 [31:0]
    connect \CLK \clk [0]
    connect \Q \direct_gt_reg
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  process $80
    assign $28 [127:0] \result_cap [127:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $28 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
        end
      case 4'0001
        switch \direct_mode [0]
          case 1'1
            assign $28 [31:0] \direct_gt_reg [31:0]
          case
        end
      case 4'0011
      case 4'0101
      case 4'0110
        switch 1'1
          case 1'1
            assign $28 [31:0] { \port$1203$0 [15:0] \port$1202$0 [15:0] }
        end
      case 4'0010
      case 4'0111
        switch 1'1
          case 1'1
            assign $28 [63:32] { \port$1203$0 [15:0] \port$1202$0 [15:0] }
        end
      case 4'1000
        switch 1'1
          case 1'1
            assign $28 [95:64] { \port$1203$0 [15:0] \port$1202$0 [15:0] }
        end
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $28 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:59"
  cell $dff $81
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $28 [127:0]
    connect \CLK \clk [0]
    connect \Q \result_cap
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  process $82
    assign $29 [3:0] \sub_fault_type [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $29 [3:0] 4'0000
        end
      case 4'0001
      case 4'0011
        switch { $20 [0] \src_is_null [0] }
          case 2'-1
            assign $29 [3:0] 4'0111
          case 2'1-
            assign $29 [3:0] 4'0100
          case
        end
      case 4'0101
        switch $21 [0]
          case 1'1
            assign $29 [3:0] 4'1000
          case
        end
      case 4'0110
      case 4'0010
        switch $22 [0]
          case 1'1
            assign $29 [3:0] 4'1000
          case
        end
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $29 [3:0] 4'0000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:60"
  cell $dff $83
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $29 [3:0]
    connect \CLK \clk [0]
    connect \Q \sub_fault_type
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  process $84
    assign $30 [3:0] \mload_state [3:0]
    switch \mload_state [3:0]
      case 4'0000
        switch \sub_start [0]
          case 1'1
            assign $30 [3:0] 4'0001
        end
      case 4'0001
        switch \direct_mode [0]
          case 1'1
            assign $30 [3:0] 4'0010
          case
            assign $30 [3:0] 4'0011
        end
      case 4'0011
        switch { $20 [0] \src_is_null [0] }
          case 2'-1
            assign $30 [3:0] 4'0100
          case 2'1-
            assign $30 [3:0] 4'0100
          case
            assign $30 [3:0] 4'0101
        end
      case 4'0101
        switch $21 [0]
          case 1'1
            assign $30 [3:0] 4'0100
          case
            assign $30 [3:0] 4'0110
        end
      case 4'0110
        switch 1'1
          case 1'1
            assign $30 [3:0] 4'0010
        end
      case 4'0010
        switch $22 [0]
          case 1'1
            assign $30 [3:0] 4'0100
          case
            assign $30 [3:0] 4'0111
        end
      case 4'0111
        switch 1'1
          case 1'1
            assign $30 [3:0] 4'1000
        end
      case 4'1000
        switch 1'1
          case 1'1
            assign $30 [3:0] 4'1001
        end
      case 4'1001
        assign $30 [3:0] 4'1010
      case 4'1010
        assign $30 [3:0] 4'0000
      case 4'0100
        assign $30 [3:0] 4'0000
    end
    switch \rst [0]
      case 1'1
        assign $30 [3:0] 4'0000
    end
  end

  attribute \src "/nix/store/h097imm3w6dpx10qynrd2sz9fks2wbq8-python3-3.12.11/lib/python3.12/contextlib.py:144"
  cell $dff $85
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $30 [3:0]
    connect \CLK \clk [0]
    connect \Q \mload_state
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  process $86
    assign $31 [127:0] \src_cap [127:0]
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
        switch \direct_mode [0]
          case 1'1
          case
            assign $31 [127:0] \cr_rd_data [127:0]
        end
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $31 [127:0] 128'00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:58"
  cell $dff $87
    parameter \WIDTH 128
    parameter \CLK_POLARITY 1
    connect \D $31 [127:0]
    connect \CLK \clk [0]
    connect \Q \src_cap
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:85"
  process $88
    assign $32 [31:0] \ns_w1_saved [31:0]
    switch \mload_state [3:0]
      case 4'0000
      case 4'0001
      case 4'0011
      case 4'0101
      case 4'0110
      case 4'0010
      case 4'0111
      case 4'1000
        switch 1'1
          case 1'1
            assign $32 [31:0] { \port$1203$0 [15:0] \port$1202$0 [15:0] }
        end
      case 4'1001
      case 4'1010
      case 4'0100
    end
    switch \rst [0]
      case 1'1
        assign $32 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/mload.py:85"
  cell $dff $89
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $32 [31:0]
    connect \CLK \clk [0]
    connect \Q \ns_w1_saved
  end

connect \clist_gt_addr $2 [31:0]
connect \ns_entry_addr $6 [31:0]
connect \fault_type_reg \sub_fault_type [3:0]
connect \mem_rd_valid 1'1
connect \mem_rd_data { \port$1203$0 [15:0] \port$1202$0 [15:0] }
connect \src_cap.word0_gt \src_cap [31:0]
connect \src_cap.word0_gt.gt_type \src_cap [1:0]
connect \src_cap.word0_gt.perms \src_cap [7:2]
connect \src_cap.word0_gt.index \src_cap [24:8]
connect \src_cap.word0_gt.version \src_cap [31:25]
connect \src_cap.word1_location \src_cap [63:32]
connect \src_cap.word2_limit \src_cap [95:64]
connect \src_cap.word3_seals \src_cap [127:96]
connect \cr15_namespace.word0_gt \cr15_namespace [31:0]
connect \cr15_namespace.word0_gt.gt_type \cr15_namespace [1:0]
connect \cr15_namespace.word0_gt.perms \cr15_namespace [7:2]
connect \cr15_namespace.word0_gt.index \cr15_namespace [24:8]
connect \cr15_namespace.word0_gt.version \cr15_namespace [31:25]
connect \cr15_namespace.word1_location \cr15_namespace [63:32]
connect \cr15_namespace.word2_limit \cr15_namespace [95:64]
connect \cr15_namespace.word3_seals \cr15_namespace [127:96]
connect \result_cap.word0_gt \result_cap [31:0]
connect \result_cap.word0_gt.gt_type \result_cap [1:0]
connect \result_cap.word0_gt.perms \result_cap [7:2]
connect \result_cap.word0_gt.index \result_cap [24:8]
connect \result_cap.word0_gt.version \result_cap [31:25]
connect \result_cap.word1_location \result_cap [63:32]
connect \result_cap.word2_limit \result_cap [95:64]
connect \result_cap.word3_seals \result_cap [127:96]
connect \cr_wr_data.word0_gt \cr_wr_data [31:0]
connect \cr_wr_data.word0_gt.gt_type \cr_wr_data [1:0]
connect \cr_wr_data.word0_gt.perms \cr_wr_data [7:2]
connect \cr_wr_data.word0_gt.index \cr_wr_data [24:8]
connect \cr_wr_data.word0_gt.version \cr_wr_data [31:25]
connect \cr_wr_data.word1_location \cr_wr_data [63:32]
connect \cr_wr_data.word2_limit \cr_wr_data [95:64]
connect \cr_wr_data.word3_seals \cr_wr_data [127:96]
connect \cr_rd_data.word0_gt \cr_rd_data [31:0]
connect \cr_rd_data.word0_gt.gt_type \cr_rd_data [1:0]
connect \cr_rd_data.word0_gt.perms \cr_rd_data [7:2]
connect \cr_rd_data.word0_gt.index \cr_rd_data [24:8]
connect \cr_rd_data.word0_gt.version \cr_rd_data [31:25]
connect \cr_rd_data.word1_location \cr_rd_data [63:32]
connect \cr_rd_data.word2_limit \cr_rd_data [95:64]
connect \cr_rd_data.word3_seals \cr_rd_data [127:96]

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/boot_rom.py:88"
module \top.boot_rom

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:90"
  wire width 32 \rom_comb

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \rst

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:84"
  wire width 9 input 2  \addr

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:85"
  attribute \init 32'00000000000000000000000000000000
  wire width 32 output 3  \data

  wire width 32 $1

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:90"
  process $2
    assign \rom_comb [31:0] 32'00000000000000000000000000000000
    switch \addr [8:0]
      case 9'000000000
        assign \rom_comb [31:0] 32'00000111000010110000000000000000
      case 9'000000001
        assign \rom_comb [31:0] 32'00000111000100110000000000000001
      case 9'000000010
        assign \rom_comb [31:0] 32'00110111000100000000000000000011
      case 9'000000011
        assign \rom_comb [31:0] 32'00111111000100000000000000000000
      case 9'000000100
        assign \rom_comb [31:0] 32'00000111000000110000000000000110
      case 9'000000101
        assign \rom_comb [31:0] 32'00110111000000000000000000001000
      case 9'000000110
        assign \rom_comb [31:0] 32'00010111000000000000000000000000
      case 9'000000111
        assign \rom_comb [31:0] 32'00000111001110110000000000000001
      case 9'000001000
        assign \rom_comb [31:0] 32'00110111001110000000000000000011
      case 9'000001001
        assign \rom_comb [31:0] 32'00111111001110000000000000000000
      case 9'000001010
        assign \rom_comb [31:0] 32'00011111000000101000000000000000
      case 9'000001011
        assign \rom_comb [31:0] 32'00001111001100001000000000000010
      case
        assign \rom_comb [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:85"
  process $3
    assign $1 [31:0] \rom_comb [31:0]
    switch \rst [0]
      case 1'1
        assign $1 [31:0] 32'00000000000000000000000000000000
    end
  end

  attribute \src "/home/runner/workspace/church_machine/boot_rom.py:85"
  cell $dff $4
    parameter \WIDTH 32
    parameter \CLK_POLARITY 1
    connect \D $1 [31:0]
    connect \CLK \clk [0]
    connect \Q \data
  end

end

attribute \generator "Amaranth"
attribute \src "/home/runner/workspace/church_machine/pico_ice.py:27"
module \top.spram

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:29"
  wire width 4 \maskwren

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:32"
  wire width 4 \maskwren_hi

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:22"
  wire width 32 \rd_data

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:24"
  wire width 1 \cs

  attribute \src "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 0  \clk

  wire width 16 output 1  \port$1202$0

  wire width 16 output 2  \port$1203$0

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:20"
  wire width 14 input 3  \addr

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:21"
  wire width 32 input 4  \wr_data

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:23"
  wire width 1 input 5  \wr_en

  wire width 16 $1

  wire width 16 $2

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:30"
  cell $mux $3
    parameter \WIDTH 4
    connect \S \wr_en [0]
    connect \A 4'0000
    connect \B 4'1111
    connect \Y \maskwren
  end

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:33"
  cell $mux $4
    parameter \WIDTH 4
    connect \S \wr_en [0]
    connect \A 4'0000
    connect \B 4'1111
    connect \Y \maskwren_hi
  end

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:35"
  cell \SB_SPRAM256KA \spram_lo
    connect \ADDRESS \addr [13:0]
    connect \DATAIN \wr_data [15:0]
    connect \MASKWREN \maskwren [3:0]
    connect \WREN \wr_en [0]
    connect \CHIPSELECT 1'1
    connect \CLOCK \clk [0]
    connect \STANDBY 1'0
    connect \SLEEP 1'0
    connect \POWEROFF 1'1
    connect \DATAOUT $1
  end

  attribute \src "/home/runner/workspace/church_machine/pico_ice.py:48"
  cell \SB_SPRAM256KA \spram_hi
    connect \ADDRESS \addr [13:0]
    connect \DATAIN \wr_data [31:16]
    connect \MASKWREN \maskwren_hi [3:0]
    connect \WREN \wr_en [0]
    connect \CHIPSELECT 1'1
    connect \CLOCK \clk [0]
    connect \STANDBY 1'0
    connect \SLEEP 1'0
    connect \POWEROFF 1'1
    connect \DATAOUT $2
  end

connect \rd_data { $2 [15:0] $1 [15:0] }
connect \cs 1'1
connect \port$1202$0 $1 [15:0]
connect \port$1203$0 $2 [15:0]

end

