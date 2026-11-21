# data/replays

Shipped sample sessions in replay format v2. All load in the application **except**
`k5-integrity.replay.json`: it records a session of the *test-only* strategy
`test:k5-misplace` (a deliberately broken copy of esmb-k5 whose A3 is mis-placed, to pin the
strategy-integrity-failure path and its replay). The production registry must never register a
broken strategy, so the app correctly answers "unknown strategyId". The tests register the
strategy before validating it. This is by design.
