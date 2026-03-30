-- =========================================================================
-- CTMM.Instructions.PermTest: Permission Test Instruction
-- =========================================================================
-- Implements TPERM for testing capability permissions and bounds.
-- Primary purpose: Validate gifted GTs aren't malware tricks.

module CTMM.Instructions.PermTest (
    instrTPERM
) where

import qualified Data.Map as Map
import CTMM.Core.Types

-- | Parse a permission mask string into a list of Permission values
-- Mask is a string like "RW", "LS", "EB" — E isolation enforced: LE/SE/LSE are invalid presets
parseMask :: String -> [Permission]
parseMask = concatMap charToPerm
  where
    charToPerm 'R' = [PermRead]
    charToPerm 'W' = [PermWrite]
    charToPerm 'X' = [PermExecute]
    charToPerm 'L' = [PermLoad]
    charToPerm 'S' = [PermSave]
    charToPerm 'E' = [PermEnter]
    charToPerm 'B' = [PermBind]
    charToPerm _   = []

-- | Check if capability has ALL permissions in the mask
hasAllPerms :: [Permission] -> [Permission] -> Bool
hasAllPerms required actual = all (`elem` actual) required

-- | Get size from capability location (for bounds checking)
-- For simulation purposes, we derive a size from the location
-- In real hardware, size would be part of the capability structure
getCapabilitySize :: ContextRegister -> Int
getCapabilitySize cr = case cachedLoc cr of
    Local offset -> if offset == 0 then 0 else 4096  -- Default 4KB for non-null
    Literal name -> case name of
        "NULL" -> 0
        _      -> 65536  -- Default 64KB for named capabilities

-- | TPERM: Test Permissions
-- Syntax: TPERM cr mask [BOUNDS offset]
-- Sets Z=1 if all permissions in mask are present AND (if BOUNDS specified) offset <= size
-- Sets Z=0 if any check fails
-- Also sets N based on whether any permissions exist
-- Valid CR indices: 0-7, 8 (Thread), 15 (Namespace)
instrTPERM :: CPUState -> Int -> String -> Maybe Int -> CPUState
instrTPERM cpu crIdx mask boundsOffset =
    let cr = if crIdx >= 0 && crIdx < 8 
             then Map.findWithDefault emptyCR crIdx (c_regs cpu)
             else case crIdx of
                 8  -> cr8_Thread cpu
                 15 -> cr15_NS cpu
                 _  -> emptyCR  -- Invalid index treated as NULL
        
        requiredPerms = parseMask mask
        actualPerms = activePerms cr
        
        permsOK = hasAllPerms requiredPerms actualPerms
        
        boundsOK = case boundsOffset of
            Nothing     -> True
            Just offset -> offset <= getCapabilitySize cr
        
        allOK = permsOK && boundsOK
        hasAnyPerm = not (null actualPerms)
        
        newFlags = CondFlags {
            flagN = not hasAnyPerm,  -- N=1 if no permissions (null capability)
            flagZ = allOK,           -- Z=1 if all checks pass
            flagC = permsOK,         -- C=1 if permissions check passed
            flagV = boundsOK         -- V=1 if bounds check passed (or no bounds)
        }
    in cpu { condFlags = newFlags }
