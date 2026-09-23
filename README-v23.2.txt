Score Condensor v23.2 — OMR guardrails / Terra credit protection

- Accepts namespace-prefixed score-partwise roots.
- Rejects score-timewise or incomplete first-pass OMR locally before any verification call.
- Verification is OFF by default to avoid an automatic second paid model call.
- If an optional verification call returns malformed/non-partwise XML, keeps the already-valid first pass instead of discarding the paid transcription.
- UI reports API input/output token counts returned by the Responses API.
- Existing multi-image, historical/music-only OMR behavior retained.
