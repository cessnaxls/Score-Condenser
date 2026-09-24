Score Condensor v17 — intelligent condensing repair

- Fixes the v16 regression where Literal and Intelligent modes used effectively the same ownership logic.
- Intelligent mode now discards source voice ownership for compatible note events and packs them into persistent up/down keyboard layers.
- Conservative/Balanced/Compact now materially affect how unassigned inner notes are packed.
- Pitch, measure-relative onset and duration remain immutable and are validated after packing.
- Every imported source rest remains preserved exactly.
- Beams are regenerated only after final intelligent lane assignment, with the existing maximum-four-note rule.
- Literal mode retains source-oriented ownership and true-chord stacking behavior.
- v16 raster-PNG PDF path is unchanged.
