# Submission — The Untested API

```bash
cd task-api && npm install
npm test            # 127 tests
npm run coverage
```

| Deliverable | Where |
|---|---|
| Unit tests | `task-api/tests/taskService.test.js`, `task-api/tests/validators.test.js` |
| Integration tests | `task-api/tests/tasks.api.test.js`, `task-api/tests/assign.api.test.js` |
| Bug report | [`BUGS.md`](./BUGS.md) — 7 bugs + 1 doc bug, with location, cause and fix for each |
| Fix | BUG-1 (pagination), commit `Day 2 (B)` — notes at the bottom of `BUGS.md` |
| Feature | `PATCH /tasks/:id/assign`, commit `Day 2 (C)` |

The commits follow the order of the work: tests → bug report → fix → feature.

## Coverage

Day 1 (original code, tests only) — 86 tests:

```
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
All files        |    98.5 |    97.33 |   96.15 |   98.36 |
 app.js          |   84.61 |       75 |      50 |   84.61 | 17-18
 tasks.js        |     100 |      100 |     100 |     100 |
 taskService.js  |     100 |    94.11 |     100 |     100 | 22
 validators.js   |     100 |      100 |     100 |     100 |
```

Final (after fix + feature) — 127 tests:

```
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
All files        |    98.8 |    97.89 |   96.77 |   98.69 |
 app.js          |   84.61 |       75 |      50 |   84.61 | 17-18
 tasks.js        |     100 |      100 |     100 |     100 |
 taskService.js  |     100 |    95.23 |     100 |     100 | 23
 validators.js   |     100 |      100 |     100 |     100 |
```

The uncovered lines in `app.js` are the `app.listen` block, which only runs when
the file is started directly. The uncovered branch in `taskService.js` is the
"unknown status" case in `getStats`, which is only reachable via BUG-5.

## How the tests are organised

- **Unit tests** call `taskService` and the validators directly. **Integration tests**
  go through HTTP with Supertest and assert on status codes and response bodies,
  not on internals. The store is reset before every test via `_reset()`.
- **Known bugs are written as `test.failing`**, tagged with the bug ID. Each one
  asserts the *correct* behaviour, so the suite stays green while a bug is known
  and open, and turns red when the bug gets fixed — at which point the test is
  switched to a plain `test`. That's exactly what happened with BUG-1: the Day 1
  commit has 12 `test.failing(... BUG-1)` tests; the fix commit flips them.
  The alternative (asserting today's buggy output) would lock bugs in as behaviour.
- Overdue logic is tested with far-past/far-future dates, plus one fake-timer test
  for the exact "now" boundary.

## `PATCH /tasks/:id/assign` — design decisions

| Situation | Result | Why |
|---|---|---|
| `{ "assignee": "Priya" }` | 200, full updated task | As specified |
| Name has surrounding spaces | Stored trimmed | `"  Priya "` and `"Priya"` shouldn't be two different people |
| `""` or `"   "` | 400 | An empty name isn't a person. It would also be ambiguous — does it mean "unassign"? I'd rather that be explicit |
| `{ "assignee": null }` | 200, unassigned | Without this there's no way to unassign a task. `null` matches how the task shape represents "no value" elsewhere (`dueDate`, `completedAt`) |
| Field missing / misspelled | 400 `assignee is required` | Catches client typos like `assigne` instead of silently doing nothing |
| Number, boolean, array, object | 400 | Only names are accepted |
| More than 100 characters | 400 | Cheap guard against junk/abuse in an unbounded in-memory store |
| Task already assigned | 200, replaced | Reassigning is a normal workflow (hand-offs, people going on leave). Rejecting with 409 would force clients into unassign-then-assign, which is two requests and racy. If "don't silently steal someone's task" matters, I'd add an optional `expectedAssignee` precondition rather than blocking all reassignment |
| Same assignee again | 200, unchanged | Idempotent, safe to retry |
| Task is `done` | 200 | Assignment is "who owns this", and that's still meaningful for completed work (auditing, reopening). Easy to change if the product disagrees |
| Unknown task | 404 | As specified |
| Unknown task **and** invalid body | 400 | Validation runs first, same order as `PUT /tasks/:id`, so the API behaves consistently |

New tasks now include `assignee: null`, so every task has the same shape whether or
not it has ever been assigned.

The assignee is a free-text name because there's no user model. In a real system
this should be a user ID validated against a users table — see questions below.

Known gap: because of BUG-4, `PUT /tasks/:id` can still set `assignee` to anything
(e.g. a number), bypassing this endpoint's validation. That's the strongest argument
for fixing BUG-4 next.

## Short note

**What I'd test next.** First, the open bugs: fixing BUG-4 (mass assignment) and
BUG-5 (falsy values bypassing validation) is mostly about tightening input rules,
so I'd write a table-driven test of every field × every awkward value (`""`, `null`,
`0`, `false`, arrays, objects, very long strings) against both POST and PUT. Then
concurrency-ish behaviour: interleaved updates to the same task, and deleting a task
between list and update calls. Then contract tests on the response shape (e.g. a
JSON schema) so accidental field changes like BUG-3 get caught automatically,
and `dueDate` edge cases like time zones and date-only strings (`"2030-01-01"`
parses as UTC midnight, so a task due "on the 1st" becomes overdue on the evening of
the 31st for a user in the Americas).

**What surprised me.** How many bugs sit in very little code, and that most of them
share a root cause: JavaScript truthiness. `body.status && ...` skips validation for
`""` and `null`, `parseInt(x) || 1` lets negatives through, and `status.includes()`
reads like equality but isn't. Also that fixing BUG-1 naively would have made things
*worse* — the negative-page input that currently returns `[]` would start returning
tasks from the end of the list. And the `priority: 'medium'` in `completeTask` looks
like a copy-paste slip, which is the kind of bug that only a test that checks
"nothing else changed" will catch. Finally, the README and the code disagree on the
status values, so any client built from the docs would fail on its first request.

**Questions before shipping to production.**
1. **Persistence:** the store is in memory, so every deploy or crash wipes all data,
   and it can't run on more than one instance. What's the storage plan?
2. **Auth:** there's none. Who can read, edit and delete which tasks? Should
   `assignee` be a real user ID, and can anyone assign anyone?
3. **Status rules:** should `PUT` be allowed to set `status: "done"`, or only
   `/complete`? Can a done task be reopened? (Affects BUG-7.)
4. **API contract:** which status vocabulary is right — the code's or the README's?
   Is `PUT` meant to be a full replace or a partial update? Should list endpoints
   return pagination metadata and cap `limit`?
5. **Operations:** request logging, rate limiting, body size limits, and do 5xx
   errors page anyone? (BUG-6 would currently create false alarms.)
