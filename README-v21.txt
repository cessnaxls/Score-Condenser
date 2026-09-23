Score Condensor v21

Fixes early-music augmentation and imported irregular measures:
- Added Auto augmentation: 2/4-equivalent measures -> 2/2, 3/4-equivalent measures -> 3/2.
- Manual 2/2 or 3/2 modes now affect only compatible source measures instead of failing on other meters.
- Full-measure rests with compressed multi-bar durations are normalized to the current source measure span.
- Overfull/OMR phrase measures no longer hard-fail rhythmic validation; their imported span is preserved.
- Rich MusicXML part-name objects no longer display as [object Object].
