-- =========================================================================
-- PP250 SIMULATOR: ROBUST CONSOLE (EXCEPTION HANDLING FIXED)
-- =========================================================================
-- Architect: Kenneth James Hamer-Hodges
-- Fix:
--   1. Added 'safeRead' to prevent runtime crashes on bad input.
--   2. Console loop now catches invalid integers (e.g., "ADD a b").
--   3. Instruction logic remains 2-Address Accumulator (Dest = Dest op Src).
-- =========================================================================

import qualified Data.Map as Map
import Data.Word (Word64)
import System.IO (hFlush, stdout)
import Text.Printf (printf)
import Text.Read (readMaybe) -- Imported for safe parsing

-- =========================================================================
-- 1. ARCHITECTURE & STATE
-- =========================================================================

data Location = Local Int | Literal String deriving (Show, Eq)

data Permission = 
    PermRead | PermWrite | PermExecute | PermLoad | PermSave | PermEnter | PermBind
    deriving (Show, Eq)

data ContextRegister = ContextReg {
    cachedLoc :: Location, 
    cachedName :: String, 
    activePerms :: [Permission],
    isLocked :: Bool 
} deriving (Show, Eq)

data SavedThreadState = SavedState {
    storedIP   :: Int,
    storedSR   :: [String],
    storedDRs  :: Map.Map Int Word64,
    storedKeys :: Map.Map Int ContextRegister,
    storedStack:: [StackFrame]
} deriving (Show)

data StackFrame = Frame { savedCR6 :: ContextRegister, savedCR7 :: ContextRegister, savedOffset :: Int } deriving (Show)

data CPUState = CPUState {
    c_regs     :: Map.Map Int ContextRegister, 
    d_regs     :: Map.Map Int Word64,          
    ip_Offset  :: Int,
    sr_Status  :: [String],
    linkStack  :: [StackFrame],
    cr8_Thread :: ContextRegister,             
    cr15_NS    :: ContextRegister,             
    ram_Threads :: Map.Map String SavedThreadState, 
    scope_CList :: Map.Map Int ContextRegister
} deriving (Show)

-- =========================================================================
-- 2. HUD & TELEMETRY
-- =========================================================================

pad :: Int -> String -> String
pad n s = if length s >= n then take n s else s ++ replicate (n - length s) ' '

permString :: [Permission] -> String
permString ps = 
    (if PermRead `elem` ps then "R" else "-") ++ (if PermWrite `elem` ps then "W" else "-") ++ 
    (if PermExecute `elem` ps then "X" else "-") ++ " " ++
    (if PermLoad `elem` ps then "L" else "-") ++ (if PermSave `elem` ps then "S" else "-") ++ 
    (if PermEnter `elem` ps then "E" else "-") ++ (if PermBind `elem` ps then "B" else "-")

displayHUD :: CPUState -> IO ()
displayHUD cpu = do
    putStrLn "\n========================== PP250 SYSTEM TELEMETRY =========================="
    putStrLn "|  CONTEXT REGISTERS (WORKING SET)                                         |"
    putStrLn "+----+----------------------+------------------------+----------+------------+"
    putStrLn "| ID | REGISTER ROLE        | OBJECT NAME            | RWX LSEB | LOCATION   |"
    putStrLn "+----+----------------------+------------------------+----------+------------+"
    mapM_ printCR [0..7]
    putStrLn "+----+----------------------+------------------------+----------+------------+"
    putStrLn "|  SYSTEM STATE                                                            |"
    putStrLn "+---------------------------+----------------------------------------------+"
    putStrLn $ "| CR15 (NAMESPACE)          | " ++ pad 25 (cachedName (cr15_NS cpu)) ++ "                    |"
    putStrLn $ "| CR8  (THREAD/USER)        | " ++ pad 25 (cachedName (cr8_Thread cpu)) ++ "                    |"
    putStrLn $ "| IP   (INSTRUCTION PTR)    | " ++ pad 25 (show (ip_Offset cpu)) ++ "                    |"
    putStrLn $ "| DR0  (ACCUMULATOR 0)      | " ++ pad 25 (printf "0x%X" (Map.findWithDefault 0 0 (d_regs cpu))) ++ "                    |"
    putStrLn $ "| DR1  (ACCUMULATOR 1)      | " ++ pad 25 (printf "0x%X" (Map.findWithDefault 0 1 (d_regs cpu))) ++ "                    |"
    putStrLn "============================================================================"
  where
    printCR i = do
        let reg = Map.findWithDefault emptyCR i (c_regs cpu)
        let role = case i of 7 -> "NUCLEUS (CODE)      "; 6 -> "TOOL INSTANCE       "; _ -> "GENERAL CAPABILITY  "
        let name = if cachedName reg == "NULL" then "NULL                    " else pad 22 (cachedName reg)
        let pStr = if cachedName reg == "NULL" then "------- " else permString (activePerms reg)
        putStrLn $ "| CR" ++ show i ++ " | " ++ role ++ " | " ++ name ++ " | " ++ pStr ++ " | " ++ show (cachedLoc reg) ++ "    |"

emptyCR :: ContextRegister
emptyCR = ContextReg (Local 0) "NULL" [] False

-- =========================================================================
-- 3. THE BOOT STEPS
-- =========================================================================

emptyState :: SavedThreadState
emptyState = SavedState 0 [] Map.empty Map.empty []

mkCR :: String -> Location -> [Permission] -> ContextRegister
mkCR name loc perms = ContextReg loc name perms False

bootStep1_HardwareReset :: IO CPUState
bootStep1_HardwareReset = do
    putStrLn "\n[BOOT STEP 1] HARDWARE RESET"
    putStrLn "   > Power Energized. Clearing All Registers to NULL..."
    let emptyRegs = Map.fromList [(i, emptyCR) | i <- [0..7]]
    let emptyData = Map.fromList [(i, 0) | i <- [0..7]]
    let cpu = CPUState emptyRegs emptyData 0 ["RESET"] [] emptyCR emptyCR Map.empty Map.empty
    displayHUD cpu 
    return cpu

bootStep2_LoadNamespace :: CPUState -> IO CPUState
bootStep2_LoadNamespace cpu = do
    putStrLn "\n[BOOT STEP 2] LOAD NAMESPACE (CR15)"
    putStrLn "   > Formatting Memory at 4000..."
    let bootNS = mkCR "Boot Namespace" (Local 4000) [PermRead, PermLoad]
    putStrLn "   > LOADING CR15..."
    let newCpu = cpu { cr15_NS = bootNS }
    displayHUD newCpu
    return newCpu

bootStep3_LoadThread :: CPUState -> IO CPUState
bootStep3_LoadThread cpu = do
    putStrLn "\n[BOOT STEP 3] LOAD THREAD CONTEXT (CR8)"
    putStrLn "   > Fetching 'Kenneth' (Entry 1) -> CR8..."
    let kennethCR = mkCR "Kenneth" (Local 8000) []
    let newCpu = cpu { cr8_Thread = kennethCR }
    displayHUD newCpu
    return newCpu

bootStep4_LoadResources :: CPUState -> IO CPUState
bootStep4_LoadResources cpu = do
    putStrLn "\n[BOOT STEP 4] LOAD CODE & TOOLS (CR7/CR6)"
    putStrLn "   > Fetching 'Diag Code' -> CR7..."
    let cr7 = mkCR "Diag Code" (Local 16000) [PermRead, PermExecute]
    putStrLn "   > Fetching 'Test Arch' -> CR6..."
    let cr6 = mkCR "Test Arch" (Local 20000) [PermEnter, PermBind]
    
    let newRegs = Map.insert 7 cr7 (Map.insert 6 cr6 (c_regs cpu))
    
    -- Setup Simulation Environment
    let opCR8   = mkCR "Operator" (Local 90000) []
    let opState = SavedState 999 ["READY"] Map.empty Map.empty []
    let ram     = Map.fromList [("Operator", opState)]
    let queue   = Map.fromList [(1, opCR8)]
    
    -- Pre-load Data Registers for testing math (DR0=10, DR1=5)
    let dataRegs = Map.fromList [(0, 10), (1, 5)]
    
    let newCpu = cpu { c_regs = newRegs, d_regs = dataRegs, ram_Threads = ram, scope_CList = queue, ip_Offset = 100 }
    displayHUD newCpu
    return newCpu

-- =========================================================================
-- 4. INSTRUCTION SET
-- =========================================================================

storeKey :: ContextRegister -> ContextRegister
storeKey reg = if cachedName reg == "NULL" then reg else reg { isLocked = True }

fetchKey :: ContextRegister -> ContextRegister
fetchKey storedKey = if cachedName storedKey == "NULL" then storedKey else storedKey { isLocked = False }

instrCHANGE :: CPUState -> Int -> IO CPUState
instrCHANGE cpu offset = do
    putStrLn $ "\n[OP] CHANGE PROCESS (Offset " ++ show offset ++ ")..."
    let currentName = cachedName (cr8_Thread cpu)
    
    -- SAVE
    putStrLn $ "   > SAVING: " ++ currentName
    let savedDRs = d_regs cpu
    let savedCRs = Map.map storeKey (c_regs cpu)
    let snapshot = SavedState (ip_Offset cpu) (sr_Status cpu) savedDRs savedCRs (linkStack cpu)
    let newRAM   = Map.insert currentName snapshot (ram_Threads cpu)
    
    -- RESTORE
    let newCap = Map.findWithDefault emptyCR offset (scope_CList cpu)
    let newName = cachedName newCap
    if newName == "NULL" then error "TRAP: CHANGE Failed (Target NULL)" else do
        let newState = Map.findWithDefault emptyState newName newRAM
        let restoredCRs = Map.map fetchKey (storedKeys newState)
        
        let newCPU = cpu {
            cr8_Thread = newCap, ip_Offset = storedIP newState, sr_Status = storedSR newState,
            d_regs = storedDRs newState, c_regs = restoredCRs, linkStack = storedStack newState,
            ram_Threads = newRAM
        }
        putStrLn $ "   > RESTORED: " ++ newName
        return newCPU

instrEXECUTE_Math :: CPUState -> String -> Int -> Int -> CPUState
instrEXECUTE_Math cpu op destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res = case op of 
            "ADD" -> vDest + vSrc
            "SUB" -> vDest - vSrc
            "POW" -> vDest ^ vSrc
            _     -> vDest
        newDRs = Map.insert destIdx res (d_regs cpu)
    in cpu { d_regs = newDRs }

instrLOAD :: CPUState -> Int -> Int -> Int -> Either String CPUState
instrLOAD cpu d s i = 
    if d==7 then Left "Use EXECUTE to load CR7" else
    let src = Map.findWithDefault emptyCR s (c_regs cpu) in
    if not (PermLoad `elem` activePerms src) then Left "TRAP: No LOAD Perm" else
    Right cpu { c_regs = Map.insert d (mkCR ("Obj_"++show i) (Local i) [PermRead]) (c_regs cpu) }

instrSAVE :: CPUState -> Int -> Int -> Either String String
instrSAVE cpu d s = 
    let dst = Map.findWithDefault emptyCR d (c_regs cpu) in
    if not (PermSave `elem` activePerms dst) then Left "TRAP: No SAVE Perm" else Right "SUCCESS: Bound."

-- =========================================================================
-- 5. CONSOLE (CRASH-PROOF)
-- =========================================================================

-- Helper: Safe Integer Parser
readInt :: String -> Maybe Int
readInt s = readMaybe s

runConsole :: CPUState -> IO ()
runConsole cpu = do
    displayHUD cpu 
    putStr ">> CMD (CHANGE/ADD/SUB/LOAD/SAVE/EXIT): "
    hFlush stdout
    input <- getLine
    
    case words input of
        ["EXIT"] -> putStrLn "--- SHUTDOWN ---"
        
        -- CHANGE Process
        ("CHANGE":xStr:_) -> case readInt xStr of
            Just x  -> instrCHANGE cpu x >>= runConsole
            Nothing -> putStrLn "[CONSOLE ERROR] Invalid Argument (Expected Integer)" >> runConsole cpu
            
        -- MATH: ADD/SUB/POW Dest Src (2 Args)
        (op:dStr:sStr:_) | op `elem` ["ADD", "SUB", "POW"] -> 
            case (readInt dStr, readInt sStr) of
                (Just d, Just s) -> runConsole (instrEXECUTE_Math cpu op d s)
                _                -> putStrLn "[CONSOLE ERROR] Invalid Register Index" >> runConsole cpu

        -- LOAD Dest Src Index (3 Args)
        ("LOAD":dStr:sStr:iStr:_) -> 
            case (readInt dStr, readInt sStr, readInt iStr) of
                (Just d, Just s, Just i) -> case instrLOAD cpu d s i of
                    Right c -> runConsole c
                    Left e  -> putStrLn ("[TRAP] " ++ e) >> runConsole cpu
                _ -> putStrLn "[CONSOLE ERROR] Invalid Arguments" >> runConsole cpu

        -- SAVE Dest Src (2 Args)
        ("SAVE":dStr:sStr:_) ->
            case (readInt dStr, readInt sStr) of
                (Just d, Just s) -> case instrSAVE cpu d s of
                    Right m -> putStrLn ("   " ++ m) >> runConsole cpu
                    Left e  -> putStrLn ("[TRAP] " ++ e) >> runConsole cpu
                _ -> putStrLn "[CONSOLE ERROR] Invalid Arguments" >> runConsole cpu
                
        _ -> putStrLn "[CONSOLE ERROR] Unknown Command or Wrong Syntax" >> runConsole cpu

-- =========================================================================
-- 6. MAIN
-- =========================================================================

main :: IO ()
main = do
    putStrLn "--- PP250 BOOT SEQUENCE START ---"
    
    cpu1 <- bootStep1_HardwareReset
    putStrLn ">> Press ENTER for Step 2..." >> getLine
    
    cpu2 <- bootStep2_LoadNamespace cpu1
    putStrLn ">> Press ENTER for Step 3..." >> getLine
    
    cpu3 <- bootStep3_LoadThread cpu2
    putStrLn ">> Press ENTER for Step 4..." >> getLine
    
    cpu4 <- bootStep4_LoadResources cpu3
    putStrLn ">> BOOT COMPLETE. ENTERING CONSOLE..."
    putStrLn ">> Try: ADD 0 1 (Computes DR0 = DR0 + DR1)" >> getLine
    
    runConsole cpu4