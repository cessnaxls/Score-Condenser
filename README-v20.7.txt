Score Condensor v20.7 — automatic import rest proofreading

Changes:
- Every imported MXL/MusicXML/MIDI score is automatically proofread before transcription.
- Existing rest glyphs are rebuilt from the actual note coverage of each individual source voice.
- Missing silence is filled; redundant/overlapping/awkwardly grouped rests are replaced.
- Rest values are regrouped metrically using the existing Analyze logic.
- Notes, pitches, durations, ties, and beam metadata are preserved during the rest-repair pass.
- Analyze remains available to rerun rest proofreading on selected voices.
