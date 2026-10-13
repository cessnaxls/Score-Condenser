# Source-to-output musical accuracy audit

1. Import a source score and choose voices.
2. Preview the reduction.
3. Click **Audit output**. The auditor compares pitch, measure-relative onset and sounding duration in the imported event model against the actual generated MusicXML. It accounts for ties split across multiple notation events by accepting continuous coverage.
4. Select **Accept correction** for a safely actionable missing note. This adds an isolated voice to the output XML and re-engraves the PDF preview. Or select **Reject / keep output** without modifying the score.
5. MusicXML, MXL, MIDI and PDF downloads use the current corrected output. Editing source/edition settings and re-previewing discards accepted output-only patches; audit again.

## Safeguards and limitations

- No change to the existing score-generation code or the original imported score.
- Unexpected output notes are flagged but never automatically deleted (a chord or tie could be corrupted).
- Octave transcription warnings require human review; the auditor cannot infer musical editorial intent.
- The auditor compares sounding pitch/onsets/duration; it does **not** validate voice leading, dynamics, lyrics, articulation, page layout, or ties crossing measures acoustically.
- Repeated identical unisons in the original can be consolidated by the engraver; the audit may not identify lost independent voice identity. Corrections may add a redundant note rather than reconstituting that voice.
- A rejected issue remains in the output by design. A zero-error report is not a guarantee of complete musical equivalence.
- No silent automatic repair. All accepted changes must be reviewed.
