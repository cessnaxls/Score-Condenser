Score Condensor v20.6 — Analyze / rest repair

Adds an Analyze button for the selected source voices. Analyze treats each voice as its own rhythmic timeline, preserves every existing note/rest, finds uncovered spans measure by measure, and inserts metrically aligned rests of the appropriate durations. Full empty measures receive measure rests. Pickup, final, and intentionally overfull measures use the source score's actual span. Re-running Analyze is idempotent because inserted rests become part of the repaired source timeline.
