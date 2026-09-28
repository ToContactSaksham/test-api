# Bug Report — Task API

Every bug below was reproduced by a test before it was written up. Bugs that are
**not** fixed are captured as `test.failing(...)` tests tagged with the bug ID:
they assert the *correct* behaviour, so Jest reports them green while the bug
exists and red the moment someone fixes it (the cue to turn them into normal tests).

Line numbers refer to the original code.

| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| BUG-1 | High | Pagination skips the first page | **Fixed** |
| BUG-2 | Medium | `?status=` does substring matching | Open |
| BUG-3 | Medium | Completing a task resets its priority to `medium` | Open |
| BUG-4 | High | `PUT` lets clients overwrite `id`, `createdAt`, `completedAt` and add arbitrary fields | Open |
| BUG-5 | High | Falsy values (`""`, `null`) bypass validation; `status: null` then crashes `GET /tasks?status=` with a 500 | Open |
| BUG-6 | Low | Malformed JSON returns 500 instead of 400 | Open |
| BUG-7 | Medium | `status` and `completedAt` can contradict each other | Open |
| DOC-1 | Low | README documents different status values than the code accepts | Open |

---

## BUG-1 — Pagination skips the first page ✅ fixed

**Where:** `src/services/taskService.js:12` — `const offset = page * limit;`

**Why:** The route treats `page` as 1-based (it defaults to `1`), but the service
computes the offset as if it were 0-based. Page 1 therefore starts at index
`limit`, and the first `limit` tasks can never be fetched through pagination.

**Expected:** `GET /tasks?page=1&limit=2` returns tasks 1–2; `page=2` returns 3–4.
**Actual:** `page=1` returns tasks 3–4. `GET /tasks?limit=3` (page defaults to 1)
also skips the first three.

**Found by:** `getPaginated › page 1 returns the first limit tasks` (unit) and
`GET /tasks?page=&limit= › pages do not overlap and together cover every task`
(integration). The "cover every task" test is the one I'd keep long-term — it
catches off-by-one errors in either direction.

**Fix:** `offset = (page - 1) * limit`. That alone isn't enough, though: the route
passes negative numbers straight through (`parseInt('-1') || 1` is `-1`), and once
the offset is fixed, `limit=-2` becomes `slice(0, -2)` — "everything except the
last two" — and a negative page reads from the *end* of the array. Before the fix
these inputs happened to return `[]`; after a naive fix they'd return wrong data.
So the fix also normalises `page` and `limit` in the route to positive integers,
falling back to the existing defaults (1 and 10), which matches how the route
already handles non-numeric input. See "Fix notes" at the bottom.

---

## BUG-2 — Status filter matches substrings

**Where:** `src/services/taskService.js:9` — `t.status.includes(status)`

**Why:** `String.prototype.includes` is a substring check, not equality.

**Expected:** `GET /tasks?status=do` returns `[]` (or a 400 — "do" isn't a status).
**Actual:** returns every `todo` *and* `done` task. `?status=o` returns nearly
everything; `?status=in` returns `in_progress` tasks.

**Found by:** `getByStatus › does not match partial status strings` — I wrote it
specifically because `includes` on a string looked suspicious when reading the code.

**Fix:** `t.status === status`. Also validate the query param against
`VALID_STATUSES` in the route and return 400 for unknown values, so a typo like
`?status=Done` gives a clear error instead of a silently empty list.

---

## BUG-3 — Completing a task resets its priority

**Where:** `src/services/taskService.js:69` — `priority: 'medium'` inside `completeTask`.

**Why:** Looks like a leftover or copy-paste from the `create` defaults. Nothing
about completing a task should touch its priority.

**Expected:** a `high` task stays `high` after `PATCH /tasks/:id/complete`.
**Actual:** it becomes `medium`. Data loss — the original priority is gone, which
also breaks any reporting on "high-priority tasks completed this week".

**Found by:** `PATCH /tasks/:id/complete › does not change the priority`. The
happy-path test only checked `status`/`completedAt`; I added this by asserting the
*rest* of the task was unchanged.

**Fix:** delete that line.

---

## BUG-4 — `PUT` allows mass assignment of server-owned fields

**Where:** `src/services/taskService.js:50` — `{ ...tasks[index], ...fields }`,
with `fields` being the raw `req.body`.

**Why:** `validateUpdateTask` only checks fields it knows about; everything else in
the body is spread onto the stored task unchecked.

**Expected:** `id`, `createdAt` and `completedAt` are server-controlled; unknown keys
are ignored or rejected.
**Actual:**
- `PUT {"id": "hijacked"}` changes the id — the task is now unreachable at its
  old URL (the next `PUT` to the original id returns 404).
- `PUT {"createdAt": "whatever"}` stores an invalid timestamp.
- `PUT {"foo": 1}` adds `foo` to the task permanently.
- With the new feature, `PUT {"assignee": 42}` bypasses the assign endpoint's
  validation entirely.

**Found by:** `update › does not allow id or createdAt to be overwritten` and
`PUT /tasks/:id › does not let the client change the id`.

**Fix:** whitelist updatable fields (`title`, `description`, `status`, `priority`,
`dueDate`) — pick only those from the body in the route or service. Decide whether
unknown keys are silently dropped or a 400; I'd lean 400 so clients learn quickly.

---

## BUG-5 — Falsy values skip validation (and can crash the list endpoint)

**Where:** `src/utils/validators.js:8,11,14,24,27,30` — every check is guarded by
`body.x && ...`. Combined with the default parameters in `create`
(`status = 'todo'` etc.), which only apply to `undefined`, not `""` or `null`.

**Expected:** `status: ""`, `status: null`, `priority: ""` etc. are rejected with 400
(or, for `dueDate: null` on update, explicitly allowed to clear the date).
**Actual:**
- `POST {"title":"A","status":"","priority":"","dueDate":""}` → 201 with all three
  stored as `""`. The task then isn't counted anywhere in `/tasks/stats`, so the
  counts no longer add up to the number of tasks.
- `PUT {"status": null}` → 200, `status` is now `null`. After that, **every**
  `GET /tasks?status=...` request returns **500**, because `getByStatus` calls
  `null.includes(...)`. One bad write takes the filter down for all users.

**Found by:** `GET /tasks?status= › keeps working after a task was updated with
status: null`. I was testing how validation treats edge-case types and the 500
fell out of it — the most serious bug here in my opinion, since it's a
single-request denial of service on a core endpoint.

**Fix:** check presence with `!== undefined` rather than truthiness, and then
validate the value's type/membership. Decide explicitly whether `dueDate: null` on
update means "clear the due date" (I'd allow that). Also validate `description`
type — today it accepts numbers/objects.

---

## BUG-6 — Malformed JSON returns 500

**Where:** `src/app.js:9-12` — the error handler always responds 500.

**Why:** `express.json()` throws a `SyntaxError` with `status: 400` for invalid JSON.
The custom handler ignores `err.status`, so a client mistake is reported as a
server fault (and logged as a stack trace, which is noise in production logs and
would page someone if 5xx rates are alerted on).

**Expected:** 400 `{ "error": "Invalid JSON body" }`.
**Actual:** 500 `{ "error": "Internal server error" }`.

**Found by:** `POST /tasks › returns 400 (not 500) for malformed JSON`.

**Fix:** in the handler, `if (err.type === 'entity.parse.failed') return res.status(400)...`,
or more generally honour `err.status`/`err.statusCode` when it's a 4xx.

---

## BUG-7 — `status` and `completedAt` can disagree

**Where:** `update` in `src/services/taskService.js` has no status-transition logic;
only `completeTask` sets `completedAt`.

**Expected:** a task with `status: "done"` has a `completedAt`; a task that isn't
done has `completedAt: null`.
**Actual:**
- `PUT {"status": "done"}` → done, but `completedAt: null`.
- Complete a task, then `PUT {"status": "todo"}` → back to todo, but it keeps the
  old `completedAt`.

**Found by:** `update › sets completedAt when status is changed to done` and
`PUT /tasks/:id › clears completedAt when a done task is reopened`.

**Fix:** in `update`, when `status` changes to `done` set `completedAt = now`
(if not already set); when it changes away from `done`, set it to `null`. Or
reject `status: "done"` on PUT and make `/complete` the only way in — a product
decision worth asking about.

---

## DOC-1 — README status values don't match the code

`README.md` documents `status` as `pending | in-progress | completed`; the code
(and `ASSIGNMENT.md`) use `todo | in_progress | done`. A client following the
README gets a 400 on every create with a status. Fix the README.

---

## Smaller things (not bugs exactly, but worth a ticket)

- **No maximum `limit`.** `?limit=1000000` returns everything. Probably cap at 100.
- **`status` and pagination can't be combined.** If `status` is present, `page`/`limit`
  are silently ignored (`src/routes/tasks.js:16-18`).
- **The list response has no pagination metadata** (total, page count), so a client
  can't tell whether there's a next page without requesting it.
- **`PUT` is documented as a "full update" but behaves like a partial update (PATCH).**
  Fine either way, but the docs and the method should agree.
- **`title` isn't trimmed**, so `"  Buy milk  "` is stored with the spaces.
- **Completing an already-completed task overwrites `completedAt`.** Arguably it
  should be idempotent and keep the original timestamp.

---

## Fix notes (BUG-1)

Changed:
- `src/services/taskService.js` — `offset = (page - 1) * limit`.
- `src/routes/tasks.js` — added a small `toPositiveInt(value, fallback)` helper so
  `page`/`limit` are always integers ≥ 1; zero, negative and non-numeric values
  fall back to the defaults.

I chose falling back to defaults over returning 400 because it's consistent with how
the route already treated non-numeric input (`parseInt('abc') || 1`), so it doesn't
change the contract for existing clients. If the team prefers strict input, it's a
one-line change to return 400 instead.

Tests: the 12 `test.failing(... BUG-1)` tests were converted to normal tests and pass.
