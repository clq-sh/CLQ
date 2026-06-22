import { assertType, expectTypeOf, test } from 'vitest';
import type {
  ColloquialContext,
  ColloquialDriver,
  ColloquialError,
  ColloquialToolDefinition,
} from './types.js';

test('ColloquialError requires code + message', () => {
  expectTypeOf<ColloquialError>().toMatchTypeOf<{ code: string; message: string }>();
  expectTypeOf<ColloquialError>().toHaveProperty('code').toBeString();
  expectTypeOf<ColloquialError>().toHaveProperty('message').toBeString();
  // cause/fix are optional
  assertType<ColloquialError>({ code: 'E_FOO', message: 'boom' });
  // @ts-expect-error code is required
  assertType<ColloquialError>({ message: 'boom' });
  // @ts-expect-error message is required
  assertType<ColloquialError>({ code: 'E_FOO' });
});

test('ColloquialToolDefinition requires name + description + input + handler', () => {
  expectTypeOf<ColloquialToolDefinition>().toHaveProperty('name').toBeString();
  expectTypeOf<ColloquialToolDefinition>().toHaveProperty('description').toBeString();
  expectTypeOf<ColloquialToolDefinition>().toHaveProperty('input');
  expectTypeOf<ColloquialToolDefinition>().toHaveProperty('handler').toBeFunction();

  assertType<ColloquialToolDefinition<string, number>>({
    name: 'add',
    description: 'adds',
    input: '' as unknown,
    handler: async ({ input }) => {
      assertType<string>(input);
      return 1;
    },
  });

  // @ts-expect-error missing handler
  assertType<ColloquialToolDefinition>({ name: 'x', description: 'y', input: 0 });
  // @ts-expect-error missing name
  assertType<ColloquialToolDefinition>({ description: 'y', input: 0, handler: async () => {} });
});

test('ColloquialDriver requires name + start + stop', () => {
  expectTypeOf<ColloquialDriver>().toHaveProperty('name').toBeString();
  expectTypeOf<ColloquialDriver>().toHaveProperty('start').toBeFunction();
  expectTypeOf<ColloquialDriver>().toHaveProperty('stop').toBeFunction();

  assertType<ColloquialDriver>({
    name: 'stdio',
    start: async () => {},
    stop: async () => {},
  });

  // @ts-expect-error missing stop
  assertType<ColloquialDriver>({ name: 'stdio', start: async () => {} });
});

test('ColloquialContext requires requestId + timestamp', () => {
  expectTypeOf<ColloquialContext>().toHaveProperty('requestId').toBeString();
  expectTypeOf<ColloquialContext>().toHaveProperty('timestamp').toBeNumber();
  assertType<ColloquialContext>({ requestId: 'r1', timestamp: 0 });
});
