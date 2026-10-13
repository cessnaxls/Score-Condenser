# Score Condensor — Verbatim Rebuild

Render deploy: publish this directory to GitHub, create a Render Node web service using `render.yaml`, or replace the existing project source. Node 22 required. `npm install` then `npm start`.

## Rules
- Only chosen source voices are emitted; no pitch shifting, octave normalizing, harmony rewriting, shortening, elimination or AI recomposition.
- Overlapping note events occupy independent engraving lanes.
- Two staves are assigned from sounding pitch (C4 and above treble, below bass); this changes staff placement only.
- Every emitted MusicXML preview and MXL/MIDI export first passes an independent source-versus-output multiset comparison of measure, onset, duration, pitch and spelling. A mismatch aborts the operation.
- The source notes are never automatically corrected. Original source rests are written when present; forward timing elements are not musical rests.
- PDF is printed from browser-rendered Verovio notation. MIDI is an inherently lossy representation of visual notation, and cannot retain written enharmonic spelling, rests, ligatures or engraving layout.

## Known limitations
- Source MusicXML must use `score-partwise`, and be representable by the existing importer. Unsupported notation can be rejected rather than silently rewritten.
- Source note timing is represented in floating quarter-note units and written at 480 divisions/quarter; uncommon irrational tuplets may not round-trip at exact resolution.
- Printed PDF notation must be visually reviewed; no PDF-to-source audit exists.
- Source expressive metadata (articulations, lyrics, ornamentation, detailed staff assignment) is not yet guaranteed to round-trip. This build verifies pitched-note events rather than every engraving symbol.
- Runtime dependency installation and full Verovio rendering are not yet validated in this workspace.


## Engraving quality update

- Better default music scale, staff spacing, system spacing, page margins and note spacing.
- Optional automatic page fitting tries a narrow range of music sizes, reducing nearly empty trailing pages where possible.
- Manual engraving sliders and portrait/landscape selection remain available. Disable Auto-fit to use the exact selected scale.
- The PDF now uses the exact automatically selected layout page dimensions and same SVG preview.
- No input notes, onsets, durations, clefs or voices are changed by the automatic layout step.
- Score fidelity validation is unchanged. Automatic layout cannot solve all conflicting notehead/voice overlaps; those require a more advanced engraving/voice assignment algorithm.
