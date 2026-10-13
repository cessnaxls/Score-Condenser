# SymbolScribe OMR Studio

Standalone human-trained PDF/image-to-MusicXML tool. Does **not** use Audiveris or an online GPT service. It recognizes **candidate** glyph regions, not entire scores reliably. User must identify symbols and enter timing/pitches manually. Breve (`breve`) and longa (`long`) are explicitly supported as MusicXML note types.

## Run

```bash
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000
```
Open http://127.0.0.1:8000. Render: deploy this directory as a Docker web service (render.yaml included).

## Workflow

1. Upload a PDF or multiple photo files.
2. Review orange candidate rectangles; select and identify each. Add missed symbols by drawing manual boxes.
3. For note and rest symbols supply part/staff, measure, 0-based beat, and pitch (for notes). Confirmation optionally saves that **visual label** to browser `localStorage`.
4. Preview the decoded note listing and download MXL, MusicXML, or PDF proof sheet.
5. Back up your training memory regularly. The browser may delete stored data when site storage is cleared or the domain changes.

## Limitations — read before relying on output

- **This is an experimental proofing workstation**, not an accurate automatic OMR engine. Notehead splitting, historical glyphs, attached stems, text and accidental detection are incomplete. Candidate regions may be false positives or incomplete; there can be *hundreds* on a page.
- Visually matched saved labels are only *suggested*. They do not determine a note's pitch, clef context, rhythmic position or duration, and users must confirm them before export.
- MusicXML export uses user-entered staff, measure, pitch and time values. Default G clef is a placeholder and needs correction for bass/C clefs; time signatures and mensural duration interpretation are **not** reconstructed. Non-note labels are saved locally but are not attached to notes during MusicXML export. The PDF export and in-app preview offer **basic treble-clef staff drawings**, not full engraved scores. C clefs, bass clefs, mensural durations, ties, beams, key signatures, articulations, repeats and text are not faithfully typeset.
- No server-side storage; uploads are held only for the import response. Files, imported images and labeled events remain in the browser tab; symbol visual labels are locally persisted.
- Export is not a verification of the underlying printed score. Always proofread against the original.

A complete, accurate symbol-graph solver and proper music engraving backend are subsequent development work; this build intentionally does not claim to have them.
