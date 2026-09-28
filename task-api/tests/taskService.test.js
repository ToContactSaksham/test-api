/**
 * Unit tests for src/services/taskService.js
 *
 * These call the service functions directly (no HTTP). The store is a module-level
 * array, so every test starts from a clean slate via _reset().
 *
 * Tests marked `test.failing` describe the CORRECT behaviour for a bug that is
 * documented in BUGS.md but intentionally not fixed yet. Jest reports them as
 * passing while the bug exists and will flip to a failure once someone fixes it,
 * which is the signal to convert them to a normal `test`.
 */
const taskService = require('../src/services/taskService');

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

beforeEach(() => {
  taskService._reset();
});

describe('create', () => {
  test('applies defaults for every optional field', () => {
    const task = taskService.create({ title: 'Write tests' });

    expect(task).toEqual({
      id: expect.any(String),
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      createdAt: expect.any(String),
    });
    expect(new Date(task.createdAt).toISOString()).toBe(task.createdAt);
  });

  test('keeps the values that are provided', () => {
    const task = taskService.create({
      title: 'Ship it',
      description: 'before Friday',
      status: 'in_progress',
      priority: 'high',
      dueDate: FUTURE,
    });

    expect(task).toMatchObject({
      title: 'Ship it',
      description: 'before Friday',
      status: 'in_progress',
      priority: 'high',
      dueDate: FUTURE,
    });
  });

  test('ignores fields that are not part of the task shape', () => {
    const task = taskService.create({ title: 'A', id: 'chosen-by-client', completedAt: PAST, foo: 'bar' });

    expect(task.id).not.toBe('chosen-by-client');
    expect(task.completedAt).toBeNull();
    expect(task).not.toHaveProperty('foo');
  });

  test('gives every task a unique id and stores it', () => {
    const a = taskService.create({ title: 'A' });
    const b = taskService.create({ title: 'B' });

    expect(a.id).not.toBe(b.id);
    expect(taskService.getAll()).toHaveLength(2);
  });
});

describe('getAll', () => {
  test('returns an empty list when there are no tasks', () => {
    expect(taskService.getAll()).toEqual([]);
  });

  test('returns tasks in insertion order', () => {
    taskService.create({ title: 'first' });
    taskService.create({ title: 'second' });

    expect(taskService.getAll().map((t) => t.title)).toEqual(['first', 'second']);
  });

  test('returns a copy, so mutating the result does not change the store', () => {
    taskService.create({ title: 'A' });
    const list = taskService.getAll();
    list.pop();

    expect(taskService.getAll()).toHaveLength(1);
  });
});

describe('findById', () => {
  test('returns the matching task', () => {
    const created = taskService.create({ title: 'A' });
    expect(taskService.findById(created.id)).toEqual(created);
  });

  test('returns undefined for an unknown id', () => {
    expect(taskService.findById('nope')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  beforeEach(() => {
    taskService.create({ title: 't1', status: 'todo' });
    taskService.create({ title: 'p1', status: 'in_progress' });
    taskService.create({ title: 'd1', status: 'done' });
    taskService.create({ title: 't2', status: 'todo' });
  });

  test('returns only tasks with that status', () => {
    expect(taskService.getByStatus('todo').map((t) => t.title)).toEqual(['t1', 't2']);
    expect(taskService.getByStatus('done').map((t) => t.title)).toEqual(['d1']);
  });

  test('returns an empty list when nothing matches', () => {
    taskService._reset();
    taskService.create({ title: 'x', status: 'todo' });
    expect(taskService.getByStatus('done')).toEqual([]);
  });

  // BUG-2: status is matched with String.includes, so partial strings match.
  test.failing('does not match partial status strings (BUG-2)', () => {
    expect(taskService.getByStatus('do')).toEqual([]);
  });
});

describe('getPaginated', () => {
  beforeEach(() => {
    for (let i = 1; i <= 5; i++) taskService.create({ title: `task ${i}` });
  });

  const titles = (list) => list.map((t) => t.title);

  // BUG-1: offset is page * limit, so page 1 skips the first page.
  test.failing('page 1 returns the first `limit` tasks (BUG-1)', () => {
    expect(titles(taskService.getPaginated(1, 2))).toEqual(['task 1', 'task 2']);
  });

  // BUG-1: offset is page * limit, so page 1 skips the first page.
  test.failing('page 2 returns the next `limit` tasks (BUG-1)', () => {
    expect(titles(taskService.getPaginated(2, 2))).toEqual(['task 3', 'task 4']);
  });

  // BUG-1: offset is page * limit, so page 1 skips the first page.
  test.failing('the last page can be partial (BUG-1)', () => {
    expect(titles(taskService.getPaginated(3, 2))).toEqual(['task 5']);
  });

  test('a page past the end is empty', () => {
    expect(taskService.getPaginated(4, 2)).toEqual([]);
  });

  // BUG-1: offset is page * limit, so page 1 skips the first page.
  test.failing('a limit larger than the list returns everything on page 1 (BUG-1)', () => {
    expect(taskService.getPaginated(1, 50)).toHaveLength(5);
  });
});

describe('getStats', () => {
  test('returns zeroes for an empty store', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts tasks by status', () => {
    taskService.create({ title: 'a', status: 'todo' });
    taskService.create({ title: 'b', status: 'todo' });
    taskService.create({ title: 'c', status: 'in_progress' });
    taskService.create({ title: 'd', status: 'done' });

    expect(taskService.getStats()).toMatchObject({ todo: 2, in_progress: 1, done: 1 });
  });

  test('counts unfinished tasks whose due date has passed as overdue', () => {
    taskService.create({ title: 'late todo', status: 'todo', dueDate: PAST });
    taskService.create({ title: 'late wip', status: 'in_progress', dueDate: PAST });

    expect(taskService.getStats().overdue).toBe(2);
  });

  test('does not count done tasks, future due dates, or tasks without a due date as overdue', () => {
    taskService.create({ title: 'done late', status: 'done', dueDate: PAST });
    taskService.create({ title: 'future', status: 'todo', dueDate: FUTURE });
    taskService.create({ title: 'no date', status: 'todo' });

    expect(taskService.getStats().overdue).toBe(0);
  });

  test('uses the current time as the overdue boundary', () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-06-15T12:00:00.000Z'));
    try {
      taskService.create({ title: 'just missed', dueDate: '2030-06-15T11:59:59.999Z' });
      taskService.create({ title: 'still ok', dueDate: '2030-06-15T12:00:00.001Z' });
      expect(taskService.getStats().overdue).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('update', () => {
  test('changes only the provided fields and persists them', () => {
    const task = taskService.create({ title: 'old', priority: 'low' });
    const updated = taskService.update(task.id, { title: 'new' });

    expect(updated).toMatchObject({ id: task.id, title: 'new', priority: 'low' });
    expect(taskService.findById(task.id).title).toBe('new');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.update('nope', { title: 'x' })).toBeNull();
  });

  // BUG-4: the update spreads the request body over the stored task, so
  // server-owned fields can be overwritten.
  test.failing('does not allow id or createdAt to be overwritten (BUG-4)', () => {
    const task = taskService.create({ title: 'A' });
    taskService.update(task.id, { id: 'hijacked', createdAt: PAST });

    expect(taskService.findById(task.id)).toMatchObject({ id: task.id, createdAt: task.createdAt });
  });

  // BUG-7: status and completedAt can disagree.
  test.failing('sets completedAt when status is changed to done (BUG-7)', () => {
    const task = taskService.create({ title: 'A' });
    expect(taskService.update(task.id, { status: 'done' }).completedAt).not.toBeNull();
  });
});

describe('remove', () => {
  test('deletes the task and returns true', () => {
    const keep = taskService.create({ title: 'keep' });
    const drop = taskService.create({ title: 'drop' });

    expect(taskService.remove(drop.id)).toBe(true);
    expect(taskService.getAll()).toEqual([keep]);
  });

  test('returns false for an unknown id and leaves the store alone', () => {
    taskService.create({ title: 'keep' });
    expect(taskService.remove('nope')).toBe(false);
    expect(taskService.getAll()).toHaveLength(1);
  });
});

describe('completeTask', () => {
  test('marks the task done and records when', () => {
    const task = taskService.create({ title: 'A' });
    const before = Date.now();
    const done = taskService.completeTask(task.id);

    expect(done.status).toBe('done');
    expect(new Date(done.completedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(taskService.findById(task.id).status).toBe('done');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.completeTask('nope')).toBeNull();
  });

  // BUG-3: completing a task silently resets its priority to "medium".
  test.failing('keeps the task priority unchanged (BUG-3)', () => {
    const task = taskService.create({ title: 'A', priority: 'high' });
    expect(taskService.completeTask(task.id).priority).toBe('high');
  });
});
