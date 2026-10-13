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


## GPT photo/PDF recognition (no Audiveris)

See [PDF-TRANSCRIPTION.md](PDF-TRANSCRIPTION.md) for deployment, costs, usage, note support, limitations and manual review. Upload ordered sheet-music photos or a PDF, then review the GPT-recognized MusicXML and apply verbatim condensation. `OPENAI_API_KEY` is required on Render.

## Precision proofreading update (experimental)

The AI **cannot be trusted to transcribe Renaissance/polyphonic printed scores note-perfectly**. This build does not claim that it can. PDF/photo import now includes an image-by-image original-source viewer and a measure/part event editor (written step, accidental, octave, onset and duration). Changes require event validation, clear prior previews, and reset all page review acknowledgments. The preview is blocked until every uploaded page is individually acknowledged as manually reviewed. This action is a *human statement of review*, **not** objective proof of accuracy. Any original voice that the AI omits entirely, or any inconsistent part/measure structure, causes a rejection rather than silent stitching. The existing source-to-output audit still verifies only the score data currently in memory, not the AI's accuracy relative to pixels.

### Recommended acceptance testing

1. Import a known MusicXML / MXL source to verify non-OMR imports still work.
2. Import one clear photo with `OPENAI_API_KEY` set, check the `sourcePages` viewer, and check every source part/measure event.
3. Change a pitch and onset; confirm the page review resets, corrected event validation succeeds, and a fresh preview is required.
4. Audition and inspect the resulting MusicXML against a trusted human transcription of the **same** page.
5. Only deploy as production once these tests pass on Render. A correct note-by-note GPT optical recognition benchmark is not yet established.


## Symbol-level OMR add-on
The hybrid mode now invokes `omr_engine.py` (OpenCV, without Audiveris) and retains `symbolReports` in its recognition metadata. It detects staff lines, potential filled noteheads and possible barlines; GPT remains responsible for clefs, rhythmic values and MusicXML interpretation. This evidence is NOT a complete trained OMR model or an accuracy guarantee. See `FULL-OMR.md`.
