Score Condensor v25.1

Fixes visual OMR completion handoff:
- validates completed OMR payload before mutating UI state
- imports the returned literal source score immediately
- automatically engraves and opens the literal source preview when OMR finishes
- leaves the source-selection/condensing controls visible even if preview engraving fails
- reports a specific post-OMR handoff/preview error without triggering another paid OMR call
- manual Source Preview button reuses the already-returned MusicXML and makes no OpenAI API call

No changes to the JSON-first OMR model call, transcription prompt, or model-call count.
