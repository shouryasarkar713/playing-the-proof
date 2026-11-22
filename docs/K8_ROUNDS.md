# K8_ROUNDS.md — move and round arithmetic from the 7-hole to the 8-hole

Source statements (Das & Valla, CGT 5(2), 2026), quoted briefly:

* Lemma 6: "a 5-hole from 7 points in the 4-th round."
* Theorem 1: "a 7-hole from 15 points in the 8-th round."
* Lemma 9: "Starting with a 7-hole, Alice can obtain an 8-hole in the game within the next
  five rounds."
* Theorem 2: "an 8-hole from 25 points in the 12-th round."

## 1. Convention implied by the source

A round is "Alice's move, then Bob's move". After Alice's r-th move there are 2r − 1 points
(she moves first). The source's own Lemma 6 and Theorem 1 follow exactly this convention:
7 = 2·4 − 1 (Alice's 4th move), 15 = 2·8 − 1 (Alice's 8th move). The phase lemmas add rounds
as Alice moves: Lemma 7 (5-hole to 6-hole) two Alice moves, Lemma 8 (6-hole to 7-hole) two
Alice moves, Lemma 9 (7-hole to 8-hole) five Alice moves, giving 4 + 2 + 2 + 5 = 13.

Assumptions of this derivation (stated, not taken from the source): (a) the 7-hole is
completed by Alice's 8th move (15 points); (b) Bob's reply to that move is the paper's B0,
so B0 is the 16th point and belongs to round 8; (c) "next five rounds" counts the five Alice
moves A1…A5 that follow, each with Bob's reply except the last; (d) the source's own
construction states that A4 ensures "an 8-hole in the next round" — that next move is A5.

## 2. Every placement from the 7-hole to the 8-hole

| placement | Maker move label | Breaker move label | cumulative points | Maker move number | Breaker move number | completed rounds after it | source-style round number |
|---|---|---|---|---|---|---|---|
| 7-hole completed | A8 (Lemma 8's A2) | — | 15 | 8 | 7 | 7 | 8 |
| Breaker reply | — | B0 | 16 | 8 | 8 | 8 | 8 |
| Maker | A1 | — | 17 | 9 | 8 | 8 | 9 |
| Breaker | — | B1 | 18 | 9 | 9 | 9 | 9 |
| Maker | A2 | — | 19 | 10 | 9 | 9 | 10 |
| Breaker | — | B2 | 20 | 10 | 10 | 10 | 10 |
| Maker | A3 | — | 21 | 11 | 10 | 10 | 11 |
| Breaker | — | B3 | 22 | 11 | 11 | 11 | 11 |
| Maker | A4 | — | 23 | 12 | 11 | 11 | 12 |
| Breaker | — | B4 | 24 | 12 | 12 | 12 | 12 |
| Maker | A5 (8-hole) | — | 25 | 13 | 12 | 12 | 13 |

Columns: *completed rounds* = number of finished (Alice, Bob) pairs after the placement;
*source-style round number* = the round the placement belongs to when a round is
(Alice, Bob) and the round number is Alice's move number (the convention of Lemma 6 and
Theorem 1).

## 3. Reconciliation

* 25 points = 2·13 − 1: the 8-hole is Alice's 13th move; twelve rounds are complete
  (24 points) when it is placed, and it is the first move of round 13.
* "The 12-th round" cannot hold together with "25 points" under any alternating
  convention in which Alice moves first: 12 rounds contain at most 24 points. Under the
  convention that makes Theorem 1 ("15 points in the 8-th round") true, 25 points is the
  13th round. The statement of Theorem 2 is therefore read here as inconsistent with the
  source's own convention; this repository uses 13 / 25 and records the source wording
  unchanged. An arithmetic slip (8 + 5 written as 12) is the likeliest origin, but that is
  an inference, not something the source states.
* Starting from the application's bare 7-point heptagon, the same five Maker moves give
  7 + 10 = 17 points at the 8-hole (no Lemma 6–8 history is present).
