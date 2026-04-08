module top(
    input clk,
    output reg tx,
    output led0,
    output led1,
    output led2,
    output led3
);
    parameter CLK_FREQ = 27000000;
    parameter BAUD = 115200;
    localparam DIVISOR = CLK_FREQ / BAUD;

    reg [25:0] blink_ctr = 0;
    always @(posedge clk)
        blink_ctr <= blink_ctr + 1;

    assign led0 = ~blink_ctr[25];
    assign led1 = ~blink_ctr[24];
    assign led2 = ~blink_ctr[23];
    assign led3 = ~blink_ctr[22];

    localparam MSG_LEN = 8;
    reg [7:0] message [0:MSG_LEN-1];
    initial begin
        message[0] = "H";
        message[1] = "E";
        message[2] = "L";
        message[3] = "L";
        message[4] = "O";
        message[5] = "\r";
        message[6] = "\n";
        message[7] = 0;
    end

    reg [7:0] counter = 0;
    reg [3:0] bit_pos = 0;
    reg [9:0] shift_reg = 10'h3FF;
    reg [2:0] msg_idx = 0;
    reg [23:0] pause_ctr = 0;

    localparam S_IDLE = 0, S_SEND = 1, S_PAUSE = 2;
    reg [1:0] state = S_IDLE;

    always @(posedge clk) begin
        case (state)
            S_IDLE: begin
                tx <= 1;
                shift_reg <= {1'b1, message[msg_idx], 1'b0};
                counter <= 0;
                bit_pos <= 0;
                state <= S_SEND;
            end

            S_SEND: begin
                tx <= shift_reg[0];
                if (counter == DIVISOR - 1) begin
                    counter <= 0;
                    shift_reg <= {1'b1, shift_reg[9:1]};
                    bit_pos <= bit_pos + 1;
                    if (bit_pos == 9) begin
                        if (msg_idx == MSG_LEN - 2) begin
                            msg_idx <= 0;
                            state <= S_PAUSE;
                        end else begin
                            msg_idx <= msg_idx + 1;
                            state <= S_IDLE;
                        end
                    end
                end else begin
                    counter <= counter + 1;
                end
            end

            S_PAUSE: begin
                tx <= 1;
                pause_ctr <= pause_ctr + 1;
                if (pause_ctr == 24'hFFFFFF)
                    state <= S_IDLE;
            end
        endcase
    end
endmodule
