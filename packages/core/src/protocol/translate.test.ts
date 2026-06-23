import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../tool.js';
import type { ColloquialContext } from '../types.js';
import {
  buildToolsList,
  dispatchToolCall,
  toolToMCPSchema,
} from './translate.js';

const ctx: ColloquialContext = { requestId: 'req-1', timestamp: 0 };

const weatherTool = defineTool({
  name: 'getWeather',
  description: 'Get the weather for a location.',
  input: z.object({ location: z.string() }),
  handler: async ({ input }) => ({ forecast: `sunny in ${input.location}` }),
});

const echoTool = defineTool({
  name: 'echo',
  description: 'Echo a message back.',
  input: z.object({ message: z.string() }),
  handler: async ({ input }) => input.message,
});

describe('toolToMCPSchema', () => {
  test('produces a JSON schema with typed properties and required fields', () => {
    const schema = toolToMCPSchema(weatherTool);
    expect(schema.name).toBe('getWeather');
    expect(schema.description).toBe('Get the weather for a location.');

    const inputSchema = schema.inputSchema as {
      properties: { location: { type: string } };
      required: string[];
    };
    expect(inputSchema.properties.location.type).toBe('string');
    expect(inputSchema.required).toContain('location');
  });
});

describe('buildToolsList', () => {
  test('maps every tool and preserves names', () => {
    const list = buildToolsList([weatherTool, echoTool]);
    expect(list.tools).toHaveLength(2);
    expect(list.tools.map((t) => t.name)).toEqual(['getWeather', 'echo']);
  });
});

describe('dispatchToolCall', () => {
  test('valid args return a success content block', async () => {
    const result = await dispatchToolCall(
      [weatherTool],
      'getWeather',
      { location: 'Paris' },
      ctx,
    );
    expect(result).not.toHaveProperty('isError');
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      forecast: 'sunny in Paris',
    });
  });

  test('unknown tool name returns isError with toolNotFound message', async () => {
    const result = await dispatchToolCall([weatherTool], 'nope', {}, ctx);
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toBe(
      "Tool 'nope' is not registered on this server.",
    );
  });

  test('invalid args against a real tool surface TOOL_INVALID_INPUT', async () => {
    const result = await dispatchToolCall(
      [weatherTool],
      'getWeather',
      { location: 123 },
      ctx,
    );
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toBe(
      "Tool 'getWeather' received invalid input.",
    );
  });

  test('non-ColloquialError thrown by a handler is rethrown, not swallowed', async () => {
    const boomTool = defineTool({
      name: 'boom',
      description: 'Throws an unexpected error.',
      input: z.object({}),
      handler: async () => {
        throw new TypeError('kaboom');
      },
    });
    await expect(
      dispatchToolCall([boomTool], 'boom', {}, ctx),
    ).rejects.toThrow('kaboom');
  });
});
