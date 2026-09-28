/**
 * Integration tests for the /tasks routes, exercised over HTTP with Supertest.
 *
 * The app and the service share the same module instance inside a Jest test file,
 * so taskService._reset() gives every test an empty store.
 *
 * `test.failing` = correct behaviour for a known, documented, not-yet-fixed bug
 * (see BUGS.md). The PATCH /tasks/:id/assign endpoint lives in assign.api.test.js.
 */
const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

const createTask = async (body = {}) => {
  const res = await request(app).post('/tasks').send({ title: 'A task', ...body });
  expect(res.status).toBe(201);
  return res.body;
};

beforeEach(() => {
  taskService._reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// For tests that deliberately trigger the app's 500 handler, which logs the stack.
const silenceErrorLog = () => jest.spyOn(console, 'error').mockImplementation(() => {});

describe('POST /tasks', () => {
  test('creates a task with defaults and returns 201', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Write tests' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
    });
  });

  test('the created task shows up in the list', async () => {
    const task = await createTask({ title: 'Persisted' });
    const res = await request(app).get('/tasks');

    expect(res.body).toEqual([task]);
  });

  test('returns 400 when the title is missing', async () => {
    const res = await request(app).post('/tasks').send({ priority: 'high' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  test('returns 400 for an invalid status, priority or dueDate', async () => {
    for (const body of [
      { title: 'A', status: 'pending' },
      { title: 'A', priority: 'urgent' },
      { title: 'A', dueDate: 'tomorrow-ish' },
    ]) {
      const res = await request(app).post('/tasks').send(body);
      expect(res.status).toBe(400);
    }
    expect((await request(app).get('/tasks')).body).toEqual([]);
  });

  test('ignores client-supplied id and completedAt', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'A', id: 'mine', completedAt: PAST });

    expect(res.body.id).not.toBe('mine');
    expect(res.body.completedAt).toBeNull();
  });

  // BUG-6: the global error handler turns body-parser's 400 into a 500.
  test.failing('returns 400 (not 500) for malformed JSON (BUG-6)', async () => {
    silenceErrorLog();
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(res.status).toBe(400);
  });

  // BUG-5: empty strings skip validation and get stored as-is.
  test.failing('does not store an empty-string status (BUG-5)', async () => {
    const res = await request(app).post('/tasks').send({ title: 'A', status: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks', () => {
  test('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns all tasks', async () => {
    await createTask({ title: 'one' });
    await createTask({ title: 'two' });

    const res = await request(app).get('/tasks');
    expect(res.body.map((t) => t.title)).toEqual(['one', 'two']);
  });
});

describe('GET /tasks?status=', () => {
  beforeEach(async () => {
    await createTask({ title: 't', status: 'todo' });
    await createTask({ title: 'p', status: 'in_progress' });
    await createTask({ title: 'd', status: 'done' });
  });

  test('returns only tasks with the requested status', async () => {
    const res = await request(app).get('/tasks?status=in_progress');

    expect(res.status).toBe(200);
    expect(res.body.map((t) => t.title)).toEqual(['p']);
  });

  test('returns an empty array for a status nobody has', async () => {
    taskService._reset();
    await createTask({ status: 'todo' });

    const res = await request(app).get('/tasks?status=done');
    expect(res.body).toEqual([]);
  });

  // BUG-2: substring match — "do" matches both "todo" and "done".
  test.failing('does not match partial status values (BUG-2)', async () => {
    const res = await request(app).get('/tasks?status=do');
    expect(res.body).toEqual([]);
  });

  // BUG-5 knock-on: a task whose status was set to null crashes the filter.
  test.failing('keeps working after a task was updated with status: null (BUG-5)', async () => {
    silenceErrorLog();
    const task = await createTask();
    await request(app).put(`/tasks/${task.id}`).send({ status: null });

    const res = await request(app).get('/tasks?status=todo');
    expect(res.status).toBe(200);
  });
});

describe('GET /tasks?page=&limit=', () => {
  const titles = (res) => res.body.map((t) => t.title);

  beforeEach(async () => {
    for (let i = 1; i <= 5; i++) await createTask({ title: `task ${i}` });
  });

  // BUG-1
  test.failing('page 1 returns the first page (BUG-1)', async () => {
    const res = await request(app).get('/tasks?page=1&limit=2');

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['task 1', 'task 2']);
  });

  // BUG-1
  test.failing('page 2 returns the second page (BUG-1)', async () => {
    const res = await request(app).get('/tasks?page=2&limit=2');
    expect(titles(res)).toEqual(['task 3', 'task 4']);
  });

  // BUG-1
  test.failing('pages do not overlap and together cover every task (BUG-1)', async () => {
    const seen = [];
    for (let page = 1; page <= 3; page++) {
      seen.push(...titles(await request(app).get(`/tasks?page=${page}&limit=2`)));
    }
    expect(seen).toEqual(['task 1', 'task 2', 'task 3', 'task 4', 'task 5']);
  });

  // BUG-1
  test.failing('defaults to page 1 when only limit is given (BUG-1)', async () => {
    const res = await request(app).get('/tasks?limit=3');
    expect(titles(res)).toEqual(['task 1', 'task 2', 'task 3']);
  });

  // BUG-1
  test.failing('defaults to a limit of 10 when only page is given (BUG-1)', async () => {
    for (let i = 6; i <= 12; i++) await createTask({ title: `task ${i}` });

    const res = await request(app).get('/tasks?page=1');
    expect(res.body).toHaveLength(10);
  });

  test('a page past the end is empty', async () => {
    const res = await request(app).get('/tasks?page=10&limit=2');
    expect(res.body).toEqual([]);
  });

  // BUG-1 (+ negative values would read from the end of the list once the offset is fixed)
  test.failing.each([
    ['non-numeric values', 'page=abc&limit=xyz'],
    ['zero', 'page=0&limit=0'],
    ['negative values', 'page=-1&limit=-2'],
  ])('falls back to the defaults for %s (BUG-1)', async (_label, query) => {
    const res = await request(app).get(`/tasks?${query}`);

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['task 1', 'task 2', 'task 3', 'task 4', 'task 5']);
  });
});

describe('PUT /tasks/:id', () => {
  test('updates the given fields and returns the task', async () => {
    const task = await createTask({ title: 'old', priority: 'low' });
    const res = await request(app).put(`/tasks/${task.id}`).send({ title: 'new', status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: task.id, title: 'new', status: 'in_progress', priority: 'low' });
  });

  test('the update is persisted', async () => {
    const task = await createTask();
    await request(app).put(`/tasks/${task.id}`).send({ priority: 'high' });

    const [stored] = (await request(app).get('/tasks')).body;
    expect(stored.priority).toBe('high');
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/tasks/does-not-exist').send({ title: 'x' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Task not found' });
  });

  test('returns 400 for invalid fields and leaves the task unchanged', async () => {
    const task = await createTask({ title: 'keep me' });
    const res = await request(app).put(`/tasks/${task.id}`).send({ title: '   ' });

    expect(res.status).toBe(400);
    expect((await request(app).get('/tasks')).body[0].title).toBe('keep me');
  });

  // BUG-4: server-owned fields can be overwritten through PUT.
  test.failing('does not let the client change the id (BUG-4)', async () => {
    const task = await createTask();
    await request(app).put(`/tasks/${task.id}`).send({ id: 'hijacked' });

    const res = await request(app).put(`/tasks/${task.id}`).send({ title: 'still here?' });
    expect(res.status).toBe(200);
  });

  // BUG-7: moving a task out of "done" leaves a stale completedAt behind.
  test.failing('clears completedAt when a done task is reopened (BUG-7)', async () => {
    const task = await createTask();
    await request(app).patch(`/tasks/${task.id}/complete`);

    const res = await request(app).put(`/tasks/${task.id}`).send({ status: 'todo' });
    expect(res.body.completedAt).toBeNull();
  });
});

describe('DELETE /tasks/:id', () => {
  test('deletes the task and returns 204 with no body', async () => {
    const task = await createTask();
    const res = await request(app).delete(`/tasks/${task.id}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect((await request(app).get('/tasks')).body).toEqual([]);
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/tasks/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('returns 404 when deleting the same task twice', async () => {
    const task = await createTask();
    await request(app).delete(`/tasks/${task.id}`);

    const res = await request(app).delete(`/tasks/${task.id}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('marks the task done and sets completedAt', async () => {
    const task = await createTask({ status: 'in_progress' });
    const res = await request(app).patch(`/tasks/${task.id}/complete`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(Date.parse(res.body.completedAt)).not.toBeNaN();
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/tasks/does-not-exist/complete');
    expect(res.status).toBe(404);
  });

  // BUG-3: priority is overwritten with "medium" on completion.
  test.failing('does not change the priority (BUG-3)', async () => {
    const task = await createTask({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${task.id}/complete`);

    expect(res.body.priority).toBe('high');
  });
});

describe('GET /tasks/stats', () => {
  test('returns zero counts for an empty store', async () => {
    const res = await request(app).get('/tasks/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts by status and counts overdue unfinished tasks', async () => {
    await createTask({ status: 'todo', dueDate: PAST }); // overdue
    await createTask({ status: 'in_progress', dueDate: PAST }); // overdue
    await createTask({ status: 'todo', dueDate: FUTURE });
    await createTask({ status: 'done', dueDate: PAST }); // done, so not overdue

    const res = await request(app).get('/tasks/stats');
    expect(res.body).toEqual({ todo: 2, in_progress: 1, done: 1, overdue: 2 });
  });

  test('reflects tasks completed through the API', async () => {
    const task = await createTask({ dueDate: PAST });
    await request(app).patch(`/tasks/${task.id}/complete`);

    const res = await request(app).get('/tasks/stats');
    expect(res.body).toMatchObject({ todo: 0, done: 1, overdue: 0 });
  });
});
