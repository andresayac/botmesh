---
'@botmesh/core': patch
---

Cron expressions that can never fire are rejected when the task is created, as the scheduler guide promised: a value out of its field's range (minute `60`, hour `24`, day `0`/`32`, month `13`, weekday `8`), a step of `0`, an inverted range (`5-1`) or a day no selected month has (`0 0 30 2 *`) now throw a `TypeError` naming the field, instead of creating a task that silently never runs. Without a time zone the next-run search now reaches four years ahead like the zoned one (a `0 0 29 2 *` task registered more than a year before the next leap day used to never run) and skips non-matching days whole, so a far yearly slot no longer blocks the event loop for tens of milliseconds.
