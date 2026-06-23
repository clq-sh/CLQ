import { expectTypeOf } from 'expect-type';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { ColloquialErrorImpl } from './errors.js';
import { defineTool } from './tool.js';
import type { ColloquialContext } from './types.js';

const ctx: ColloquialContext = {
  requestId: 'req-1',
  timestamp: 0,
};

describe('defineTool runtime behavior', () => {
  test('valid input + valid output returns the parsed result', async () => {
    const tool = defineTool({
      name: 'add',
      description: 'Add two numbers.',
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.object({ sum: z.number() }),
      handler: async ({ input }) => ({ sum: input.a + input.b }),
    });

    const result = await tool.handler({ input: { a: 2, b: 3 }, ctx });
    expect(result).toEqual({ sum: 5 });
  });

  test('invalid input throws and the real handler is never called', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const tool = defineTool({
      name: 'needsString',
      description: 'Requires a string field.',
      input: z.object({ value: z.string() }),
      handler,
    });

    await expect(
      tool.handler({ input: { value: 123 }, ctx }),
    ).rejects.toMatchObject({ code: 'TOOL_INVALID_INPUT' });
    await expect(
      tool.handler({ input: { value: 123 }, ctx }),
    ).rejects.toBeInstanceOf(ColloquialErrorImpl);
    expect(handler).not.toHaveBeenCalled();
  });

  test('valid input but invalid output throws TOOL_INVALID_OUTPUT', async () => {
    const tool = defineTool({
      name: 'badOutput',
      description: 'Returns the wrong shape on purpose.',
      input: z.object({ a: z.number() }),
      output: z.object({ sum: z.number() }),
      // @ts-expect-error deliberately returning a shape the output schema rejects
      handler: async () => ({ sum: 'not-a-number' }),
    });

    await expect(
      tool.handler({ input: { a: 1 }, ctx }),
    ).rejects.toMatchObject({ code: 'TOOL_INVALID_OUTPUT' });
  });

  test('empty description throws at defineTool() before any input is processed', () => {
    const handler = vi.fn(async () => undefined);

    expect(() =>
      defineTool({
        name: 'noDesc',
        description: '',
        input: z.object({}),
        handler,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'TOOL_MISSING_DESCRIPTION' }),
    );

    expect(() =>
      defineTool({
        name: 'wsDesc',
        description: '   \t\n  ',
        input: z.object({}),
        handler,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'TOOL_MISSING_DESCRIPTION' }),
    );

    expect(handler).not.toHaveBeenCalled();
  });

  test('no output schema passes the handler return value through unvalidated', async () => {
    const wild = { anything: Symbol('x'), nested: { n: 1 } };
    const tool = defineTool({
      name: 'passthrough',
      description: 'Returns whatever it likes, no output schema.',
      input: z.object({ go: z.boolean() }),
      handler: async () => wild,
    });

    const result = await tool.handler({ input: { go: true }, ctx });
    expect(result).toBe(wild);
  });
});

describe('defineTool type-level guarantees', () => {
  test("handler input param equals z.infer of the input schema", () => {
    const schema = z.object({ location: z.string(), days: z.number() });
    defineTool({
      name: 'forecast',
      description: 'Type-only assertion of the handler input param.',
      input: schema,
      handler: async ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<z.infer<typeof schema>>();
        expectTypeOf(input).toEqualTypeOf<{ location: string; days: number }>();
        return undefined;
      },
    });
    expect(true).toBe(true);
  });
});
