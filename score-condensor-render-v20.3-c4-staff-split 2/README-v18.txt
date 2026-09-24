Score Condensor v18 — intelligent octave normalization

- Literal mode is unchanged.
- Intelligent mode only: a bass-staff candidate more than one octave above the measure's lowest bass note is shifted down exactly one octave.
- Intelligent mode only: a treble-staff candidate more than one octave below the measure's highest treble note is shifted up exactly one octave.
- If the one-octave shift would exceed the source measure's highest-treble / lowest-bass outer bounds, that candidate is omitted.
- A candidate is shifted at most once; no repeated octave folding.
- Measure, onset and duration are immutable through this pass.
- Existing v17 condensing, rest preservation, beam cap, alignment, literal chord stacking, and raster-PNG PDF path are retained.
