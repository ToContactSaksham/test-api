/**
 * Unit tests for src/utils/validators.js
 * Each validator returns an error message string, or null when the body is valid.
 */
const { validateCreateTask, validateUpdateTask, validateAssignTask } = require('../src/utils/validators');

describe('validateCreateTask', () => {
  test('accepts a body with only a title', () => {
    expect(validateCreateTask({ title: 'A' })).toBeNull();
  });

  test('accepts a fully populated valid body', () => {
    expect(
      validateCreateTask({
        title: 'A',
        description: 'd',
        status: 'in_progress',
        priority: 'high',
        dueDate: '2030-01-01T00:00:00.000Z',
      })
    ).toBeNull();
  });

  test.each([
    ['missing', {}],
    ['empty', { title: '' }],
    ['whitespace only', { title: '   ' }],
    ['not a string', { title: 42 }],
  ])('rejects a title that is %s', (_label, body) => {
    expect(validateCreateTask(body)).toMatch(/title/);
  });

  test('rejects an unknown status', () => {
    expect(validateCreateTask({ title: 'A', status: 'pending' })).toMatch(/status/);
  });

  test('rejects an unknown priority', () => {
    expect(validateCreateTask({ title: 'A', priority: 'urgent' })).toMatch(/priority/);
  });

  test('rejects an unparseable dueDate', () => {
    expect(validateCreateTask({ title: 'A', dueDate: 'not a date' })).toMatch(/dueDate/);
  });

  // BUG-5: checks are guarded by truthiness, so "" / null / 0 skip validation.
  test.failing('rejects an empty-string status (BUG-5)', () => {
    expect(validateCreateTask({ title: 'A', status: '' })).toMatch(/status/);
  });
});

describe('validateUpdateTask', () => {
  test('accepts an empty body (nothing to change)', () => {
    expect(validateUpdateTask({})).toBeNull();
  });

  test('accepts valid partial updates', () => {
    expect(validateUpdateTask({ status: 'done' })).toBeNull();
    expect(validateUpdateTask({ priority: 'low', dueDate: '2030-01-01' })).toBeNull();
  });

  test.each([
    ['empty', ''],
    ['whitespace only', '  '],
    ['null', null],
    ['a number', 1],
  ])('rejects a title that is %s', (_label, title) => {
    expect(validateUpdateTask({ title })).toMatch(/title/);
  });

  test('rejects an unknown status, priority or dueDate', () => {
    expect(validateUpdateTask({ status: 'finished' })).toMatch(/status/);
    expect(validateUpdateTask({ priority: 'meh' })).toMatch(/priority/);
    expect(validateUpdateTask({ dueDate: 'soon' })).toMatch(/dueDate/);
  });

  // BUG-5: null skips the status check and ends up stored on the task.
  test.failing('rejects a null status (BUG-5)', () => {
    expect(validateUpdateTask({ status: null })).toMatch(/status/);
  });
});

describe('validateAssignTask', () => {
  test('accepts a name', () => {
    expect(validateAssignTask({ assignee: 'Priya' })).toBeNull();
  });

  test('accepts null (unassign)', () => {
    expect(validateAssignTask({ assignee: null })).toBeNull();
  });

  test('accepts a name at the maximum length', () => {
    expect(validateAssignTask({ assignee: 'a'.repeat(100) })).toBeNull();
  });

  test('rejects a missing assignee', () => {
    expect(validateAssignTask({})).toMatch(/assignee is required/);
  });

  test.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s', (_label, assignee) => {
    expect(validateAssignTask({ assignee })).toMatch(/non-empty/);
  });

  test.each([
    ['a number', 7],
    ['a boolean', true],
    ['an array', ['Priya']],
    ['an object', { name: 'Priya' }],
  ])('rejects %s', (_label, assignee) => {
    expect(validateAssignTask({ assignee })).toMatch(/string/);
  });

  test('rejects a name longer than 100 characters', () => {
    expect(validateAssignTask({ assignee: 'a'.repeat(101) })).toMatch(/100/);
  });
});
