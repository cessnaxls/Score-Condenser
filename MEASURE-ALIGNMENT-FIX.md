# AI OMR measure-alignment hotfix

## Problem
GPT sometimes encoded introductory silent staves as a single measure even when the other staves contain several bars. This triggered `Ambiguous staff/measure structure` and rejected the entire import.

## Fix
1. Expand **only explicitly encoded MusicXML `multiple-rest` spans** into individual silent measures (no pitched notes are created).
2. Where measure counts still disagree, retry recognition on the original system image with the mismatch and explicit instructions to track every barline and rest on every staff.
3. Revalidate part and measure counts. If the corrected result still fails, stop and report both attempts instead of silently padding measures with invented musical material.

## Scope
Existing direct MXL/MusicXML/MIDI imports, engraving, proofreading, audit and export paths remain unchanged. GPT API use for an affected system may increase because of the targeted retry.

## Verification
JavaScript syntax checks and package ZIP integrity are verified. Live OpenAI API calls, end-to-end PDF/photo recognition and Render deployment have not been tested. Historical polyphony still needs manual source-image proofreading.
