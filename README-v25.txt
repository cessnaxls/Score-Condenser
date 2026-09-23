Score Condensor v25

OMR redesign:
- Terra/Luna returns notation JSON, never MusicXML.
- Server validates event timing/collisions/staff count and builds MusicXML locally.
- System crop filenames carry detected staff count for cross-checking.
- No automatic retry or verification call; one Transcribe click = one OMR model call.
- Invalid/out-of-measure events are discarded before engraving.
- Catastrophically sparse/collision-heavy results are rejected rather than padded with fabricated rests.
