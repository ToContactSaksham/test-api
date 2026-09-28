/**
 * PATCH /tasks/:id/assign — integration tests for the new endpoint.
 *
 * Contract (see SUBMISSION.md for the reasoning):
 *   body { assignee: string }  -> assign (trimmed, 1-100 chars)
 *   body { assignee: null }    -> unassign
 *   reassigning an already-assigned task is allowed (200)
 *   400 for a missing/invalid assignee, 404 for an unknown task.
 *   Validation runs before the lookup, like PUT /tasks/:id.
 */
const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

const createTask = async (body = {}) => {
  const res = await request(app).post('/tasks').send({ title: 'A task', ...body });
  return res.body;
};

const assign = (id, body) => request(app).patch(`/tasks/${id}/assign`).send(body);

beforeEach(() => {
  taskService._reset();
});

describe('PATCH /tasks/:id/assign', () => {
  describe('happy path', () => {
    test('assigns the task and returns the full updated task', async () => {
      const task = await createTask();
      const res = await assign(task.id, { assignee: 'Priya' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...task, assignee: 'Priya' });
    });

    test('the assignment is persisted', async () => {
      const task = await createTask();
      await assign(task.id, { assignee: 'Priya' });

      const [stored] = (await request(app).get('/tasks')).body;
      expect(stored.assignee).toBe('Priya');
    });

    test('new tasks start unassigned', async () => {
      const task = await createTask();
      expect(task.assignee).toBeNull();
    });

    test('trims surrounding whitespace from the name', async () => {
      const task = await createTask();
      const res = await assign(task.id, { assignee: '  Priya Sharma  ' });

      expect(res.body.assignee).toBe('Priya Sharma');
    });

    test('can assign a task that is already done', async () => {
      const task = await createTask();
      await request(app).patch(`/tasks/${task.id}/complete`);

      const res = await assign(task.id, { assignee: 'Priya' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'done', assignee: 'Priya' });
    });
  });

  describe('when the task is already assigned', () => {
    test('reassigns it to the new person', async () => {
      const task = await createTask();
      await assign(task.id, { assignee: 'Priya' });

      const res = await assign(task.id, { assignee: 'Arjun' });
      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Arjun');
    });

    test('assigning the same person again is a no-op that still succeeds', async () => {
      const task = await createTask();
      const first = (await assign(task.id, { assignee: 'Priya' })).body;

      const res = await assign(task.id, { assignee: 'Priya' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(first);
    });

    test('null unassigns it', async () => {
      const task = await createTask();
      await assign(task.id, { assignee: 'Priya' });

      const res = await assign(task.id, { assignee: null });
      expect(res.status).toBe(200);
      expect(res.body.assignee).toBeNull();
    });
  });

  describe('does not interfere with other fields', () => {
    test('leaves status, priority, dates and title untouched', async () => {
      const task = await createTask({ priority: 'high', status: 'in_progress', dueDate: '2030-01-01T00:00:00.000Z' });
      const { assignee, ...rest } = (await assign(task.id, { assignee: 'Priya' })).body;
      const { assignee: _before, ...original } = task;

      expect(rest).toEqual(original);
    });

    test('the assignee survives a PUT and a complete', async () => {
      const task = await createTask();
      await assign(task.id, { assignee: 'Priya' });
      await request(app).put(`/tasks/${task.id}`).send({ title: 'renamed' });
      const res = await request(app).patch(`/tasks/${task.id}/complete`);

      expect(res.body.assignee).toBe('Priya');
    });
  });

  describe('validation (400)', () => {
    test.each([
      ['no body at all', undefined],
      ['an empty object', {}],
      ['a misspelled field', { assigne: 'Priya' }],
    ])('rejects %s', async (_label, body) => {
      const task = await createTask();
      const res = await assign(task.id, body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee is required/);
    });

    test.each([
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['a number', 42],
      ['a boolean', false],
      ['an array', ['Priya']],
      ['an object', { name: 'Priya' }],
      ['a name over 100 characters', 'x'.repeat(101)],
    ])('rejects %s', async (_label, assignee) => {
      const task = await createTask();
      const res = await assign(task.id, { assignee });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    });

    test('a rejected request does not change an existing assignment', async () => {
      const task = await createTask();
      await assign(task.id, { assignee: 'Priya' });
      await assign(task.id, { assignee: '' });

      const [stored] = (await request(app).get('/tasks')).body;
      expect(stored.assignee).toBe('Priya');
    });
  });

  describe('unknown task (404)', () => {
    test('returns 404 for a task that does not exist', async () => {
      const res = await assign('does-not-exist', { assignee: 'Priya' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Task not found' });
    });

    test('returns 404 for a task that was deleted', async () => {
      const task = await createTask();
      await request(app).delete(`/tasks/${task.id}`);

      const res = await assign(task.id, { assignee: 'Priya' });
      expect(res.status).toBe(404);
    });

    test('validates the body before looking up the task (consistent with PUT)', async () => {
      const res = await assign('does-not-exist', { assignee: '' });
      expect(res.status).toBe(400);
    });
  });
});
