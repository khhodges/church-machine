-- =========================================================================
-- PP250.Instructions.Switch: Namespace Relocation
-- =========================================================================
-- The SWITCH instruction updates CR15 (Namespace Register), defining
-- the "Universe" of accessible objects for the process.

module PP250.Instructions.Switch (
    instrSWITCH
) where

import qualified Data.Map as Map
import PP250.Core.Types

instrSWITCH :: CPUState -> Int -> Either String CPUState
instrSWITCH cpu srcIdx = 
    let srcCR = Map.findWithDefault emptyCR srcIdx (c_regs cpu)
    in 
    if cachedName srcCR == "NULL" 
        then Left "TRAP: Target Namespace is NULL"
    else if not (PermEnter `elem` activePerms srcCR) 
        then Left "TRAP: No ENTER Permission on Namespace Key"
    else 
        Right cpu { cr15_NS = srcCR }
