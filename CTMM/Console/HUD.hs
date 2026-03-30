-- =========================================================================
-- CTMM.Console.HUD: Head-Up Display / System Telemetry
-- =========================================================================
-- Provides the visual display of CPU state for debugging and monitoring.

module CTMM.Console.HUD (
    displayHUD,
    showHelp
) where

import qualified Data.Map as Map
import Text.Printf (printf)
import CTMM.Core.Types
import CTMM.Core.Utils

-- | Display the complete system telemetry HUD.
displayHUD :: CPUState -> IO ()
displayHUD cpu = do
    putStrLn "\n========================== CTMM SYSTEM TELEMETRY =========================="
    putStrLn "|  CONTEXT REGISTERS (WORKING SET)                                         |"
    putStrLn "+-----+---------------------+-----------------------+---------+-------------+"
    putStrLn "| ID  | REGISTER ROLE       | OBJECT NAME           | RWX LSE | LOCATION    |"
    putStrLn "+-----+---------------------+-----------------------+---------+-------------+"
    mapM_ (printCR cpu) [0..7]
    putStrLn "+-----+---------------------+-----------------------+---------+-------------+"
    
    putStrLn "|  SYSTEM STATE                                                             |"
    putStrLn "+-----------------------------+---------------------------------------------+"
    putStrLn $ "| CR15 (NAMESPACE)            | " ++ pad 43 (cachedName (cr15_NS cpu)) ++ " |"
    putStrLn $ "| CR8  (THREAD/USER)          | " ++ pad 43 (cachedName (cr8_Thread cpu)) ++ " |"
    putStrLn $ "| IP   (INSTRUCTION PTR)      | " ++ pad 43 (show (ip_Offset cpu)) ++ " |"
    putStrLn "+-----------------------------+---------------------------------------------+"
    
    putStrLn "|  DATA REGISTERS                                                           |"
    putStrLn "+-------------------+-------------------+-------------------+---------------+"
    let dr n = printf "0x%016X" (Map.findWithDefault 0 n (d_regs cpu)) :: String
    putStrLn $ "| DR0: " ++ padNoTrunc 18 (dr 0) ++ " | DR1: " ++ padNoTrunc 18 (dr 1) ++ " |"
    putStrLn $ "| DR2: " ++ padNoTrunc 18 (dr 2) ++ " | DR3: " ++ padNoTrunc 18 (dr 3) ++ " |"
    putStrLn $ "| DR4: " ++ padNoTrunc 18 (dr 4) ++ " | DR5: " ++ padNoTrunc 18 (dr 5) ++ " |"
    putStrLn $ "| DR6: " ++ padNoTrunc 18 (dr 6) ++ " | DR7: " ++ padNoTrunc 18 (dr 7) ++ " |"
    putStrLn "+-----------------------------------------------------------------------------+"
    putStrLn "|  CONDITION FLAGS (ARM-style NZCV)                                         |"
    putStrLn "+----+----------+----+-------+----+-------+----+----------+-----------------+"
    let flags = condFlags cpu
    let n = if flagN flags then "1" else "0"
    let z = if flagZ flags then "1" else "0"
    let c = if flagC flags then "1" else "0"
    let v = if flagV flags then "1" else "0"
    putStrLn $ "| N: " ++ n ++ " Negative | Z: " ++ z ++ " Zero  | C: " ++ c ++ " Carry | V: " ++ v ++ " Overflow |                 |"
    putStrLn "============================================================================="

printCR :: CPUState -> Int -> IO ()
printCR cpu i = do
    let reg = Map.findWithDefault emptyCR i (c_regs cpu)
    let role = case i of 
            7 -> "NUCLEUS (CODE)     "
            6 -> "C-LIST LCA         "
            _ -> "GENERAL CAPABILITY "
    let name = if cachedName reg == "NULL" 
               then padNoTrunc 25 "NULL" 
               else padNoTrunc 25 (cachedName reg)
    let pStr = if cachedName reg == "NULL" 
               then "--- ---" 
               else take 7 (permString (activePerms reg))
    let locStr = padNoTrunc 11 (formatLoc (cachedLoc reg))
    putStrLn $ "| CR" ++ pad 2 (show i) ++ " | " ++ role ++ " | " ++ name ++ " | " ++ pStr ++ " | " ++ locStr ++ " |"

-- | Display the command reference help screen with full ARM instruction set.
showHelp :: IO ()
showHelp = do
    putStrLn "\n============================= CTMM COMMAND REFERENCE =============================="
    putStrLn ""
    putStrLn "  SYSTEM COMMANDS"
    putStrLn "  ---------------"
    putStrLn "    HELP                    Show this help message"
    putStrLn "    HUD                     Display system telemetry panel"
    putStrLn "    NS                      Display namespace capability (CR15)"
    putStrLn "    CLIST                   Display C-List of capability keys"
    putStrLn "    FLAGS                   Display condition flags (NZCV)"
    putStrLn "    EXIT                    Shutdown the system"
    putStrLn ""
    putStrLn "  ARITHMETIC (sets NZCV flags)"
    putStrLn "  ----------------------------"
    putStrLn "    ADD  <d> <s>            DR[d] = DR[d] + DR[s]"
    putStrLn "    SUB  <d> <s>            DR[d] = DR[d] - DR[s]"
    putStrLn "    MUL  <d> <s>            DR[d] = DR[d] * DR[s]"
    putStrLn "    NEG  <d> <s>            DR[d] = -DR[s] (negate)"
    putStrLn "    ADDI <d> <imm>          DR[d] = DR[d] + immediate"
    putStrLn "    SUBI <d> <imm>          DR[d] = DR[d] - immediate"
    putStrLn ""
    putStrLn "  DATA MOVEMENT"
    putStrLn "  -------------"
    putStrLn "    MOV  <d> <s>            DR[d] = DR[s] (copy)"
    putStrLn "    MVN  <d> <s>            DR[d] = NOT DR[s] (move negated)"
    putStrLn ""
    putStrLn "  LOGIC (sets N, Z flags)"
    putStrLn "  -----------------------"
    putStrLn "    AND  <d> <s>            DR[d] = DR[d] AND DR[s]"
    putStrLn "    ORR  <d> <s>            DR[d] = DR[d] OR DR[s]"
    putStrLn "    EOR  <d> <s>            DR[d] = DR[d] XOR DR[s]"
    putStrLn "    BIC  <d> <s>            DR[d] = DR[d] AND (NOT DR[s])"
    putStrLn "    NOT  <d> <s>            DR[d] = NOT DR[s]"
    putStrLn ""
    putStrLn "  SHIFTS (sets N, Z, C flags)"
    putStrLn "  ---------------------------"
    putStrLn "    LSL  <d> <s> <amt>      Logical shift left"
    putStrLn "    LSR  <d> <s> <amt>      Logical shift right"
    putStrLn "    ASR  <d> <s> <amt>      Arithmetic shift right (sign extend)"
    putStrLn "    ROR  <d> <s> <amt>      Rotate right"
    putStrLn ""
    putStrLn "  COMPARE (sets flags only, no result)"
    putStrLn "  ------------------------------------"
    putStrLn "    CMP  <a> <b>            Compare: sets flags for DR[a] - DR[b]"
    putStrLn "    CMN  <a> <b>            Compare negative: sets flags for DR[a] + DR[b]"
    putStrLn "    TST  <a> <b>            Test bits: sets flags for DR[a] AND DR[b]"
    putStrLn "    TEQ  <a> <b>            Test equal: sets flags for DR[a] XOR DR[b]"
    putStrLn ""
    putStrLn "  PERMISSION TEST (validates gifted capabilities)"
    putStrLn "  ------------------------------------------------"
    putStrLn "    TPERM <cr> <mask>             Test if CR has all permissions in mask"
    putStrLn "    TPERM <cr> <mask> BOUNDS <n>  Also verify offset n <= capability size"
    putStrLn "      Mask: R W X L S E B (e.g. RW, LS, EB, LSB) — E isolation: E cannot combine with L or S"
    putStrLn "      Z=1 if pass, Z=0 if fail; C=perms OK, V=bounds OK, N=no perms"
    putStrLn ""
    putStrLn "  BRANCH"
    putStrLn "  ------"
    putStrLn "    B    <offset>           Unconditional branch to IP offset"
    putStrLn "    B    <cond> <offset>    Conditional branch (EQ/NE/GT/LT/GE/LE/etc)"
    putStrLn "    BL   <offset>           Branch with link (saves return addr to DR7)"
    putStrLn ""
    putStrLn "  CONDITION CODES: EQ NE CS/HS CC/LO MI PL VS VC HI LS GE LT GT LE AL"
    putStrLn ""
    putStrLn "  CAPABILITY OPERATIONS"
    putStrLn "  ---------------------"
    putStrLn "    LOAD   <d> <s> <i>      Load object at index i via CR[s] -> CR[d]"
    putStrLn "    SAVE   <d> <s>          Save DR[s] to location via CR[d]"
    putStrLn "    CALL   <reg>            Call procedure in CR[reg] (requires Enter)"
    putStrLn "    RETURN                  Return from procedure (pop stack frame)"
    putStrLn "    CHANGE <offset>         Switch to thread at scope offset"
    putStrLn "    SWITCH <reg>            Set CR15 (Namespace) to capability in CR[reg]"
    putStrLn ""
    putStrLn "======================================================================================"
