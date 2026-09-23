Score Condensor v23 — OMR accuracy + multi-image import

Changes
- Visual OMR accepts up to 20 PDFs/images in one ordered selection.
- Multiple images are treated as consecutive pages/regions of one score.
- Optional verification pass (default on) re-reads every source page and corrects pitch, rhythm, chord, accidental, rest and onset mismatches.
- Stronger anti-hallucination/music-only OMR instructions.
- Critical MusicXML cursor fix: importer now honors <backup> and <forward> in document order instead of flattening all notes. This fixes independent voices being placed at wrong onsets after OMR.
- Source ties are retained by the importer.
- OMR timing/completeness warnings retained.

Note: verification uses a second API request and therefore costs more than a single pass. It can be disabled in the UI.
