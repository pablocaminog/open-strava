import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { mintApiKey } from '../src/auth/apiKey.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
} as ExecutionContext;

async function mcpRequest(
  env: ReturnType<typeof fakeEnv>,
  apiKey: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  const app = buildApp();
  return app.request(
    '/mcp',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    env,
    mockCtx,
  );
}

async function mcpToolCall(
  env: ReturnType<typeof fakeEnv>,
  apiKey: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  return mcpRequest(env, apiKey, 'tools/call', { name, arguments: args });
}

describe('MCP schedule_workout tool', () => {
  it('returns error without write:training scope', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['read:activities']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: '2026-06-01',
      sport: 'running',
      durationMin: 60,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32004);
  });

  it('creates a planned workout', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['read:activities', 'write:training']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: '2026-06-10',
      sport: 'cycling',
      durationMin: 90,
      targetZone: 'z3',
      description: 'Threshold intervals',
      notes: '3x10 min at FTP',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { content: { text: string }[] } };
    const result = JSON.parse(body.result!.content[0]!.text) as { id: string };
    expect(typeof result.id).toBe('string');

    const db = env.DB as unknown as FakeD1;
    const pw = db.plannedWorkouts[0]!;
    expect(pw.scheduled_date).toBe('2026-06-10');
    const parsed = JSON.parse(pw.session_json as string);
    expect(parsed.sport).toBe('cycling');
    expect(parsed.durationMin).toBe(90);
    expect(parsed.targetZone).toBe('z3');
  });

  it('rejects invalid scheduledDate', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: 'not-a-date',
      sport: 'running',
      durationMin: 60,
    });
    const body = (await res.json()) as { error?: { code: number; message: string } };
    expect(body.error?.code).toBe(-32602);
  });

  it('rejects invalid sport', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: '2026-06-01',
      sport: 'weightlifting',
      durationMin: 60,
    });
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32602);
  });
});

describe('MCP list_planned_workouts tool', () => {
  it('requires read:activities scope', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'list_planned_workouts', {
      from: '2026-06-01',
      to: '2026-06-30',
    });
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32004);
  });

  it('returns workouts with session fields merged', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['read:activities']);
    const db = env.DB as unknown as FakeD1;
    db.plannedWorkouts.push({
      id: 'pw-mcp-1',
      athlete_id: 'u1',
      scheduled_date: '2026-06-15',
      notes: 'morning run',
      session_json: JSON.stringify({ sport: 'running', durationMin: 45, targetZone: 'z1' }),
      workout_id: null,
      assigned_by: 'u1',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_000,
    });

    const res = await mcpToolCall(env, key, 'list_planned_workouts', {
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { content: { text: string }[] } };
    const result = JSON.parse(body.result!.content[0]!.text) as {
      items: Record<string, unknown>[];
    };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.sport).toBe('running');
    expect(result.items[0]!.durationMin).toBe(45);
    expect(result.items[0]!.targetZone).toBe('z1');
  });
});

describe('MCP delete_planned_workout tool', () => {
  it('removes the workout and returns ok', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const db = env.DB as unknown as FakeD1;
    db.plannedWorkouts.push({
      id: 'pw-del-mcp',
      athlete_id: 'u1',
      scheduled_date: '2026-06-20',
      notes: null,
      session_json: JSON.stringify({ sport: 'swimming', durationMin: 30 }),
      workout_id: null,
      assigned_by: 'u1',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_000,
    });

    const res = await mcpToolCall(env, key, 'delete_planned_workout', { id: 'pw-del-mcp' });
    expect(res.status).toBe(200);
    expect(db.plannedWorkouts).toHaveLength(0);
  });
});

describe('MCP create_workout_from_csv', () => {
  it('creates a workout from csvText', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'create_workout_from_csv', {
      csvText: 'Threshold, cycling\nWarm up, 600\nMain, 1800, 95-105%\nCool down, 300',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    const text = body.result?.content[0]?.text ?? '';
    const data = JSON.parse(text) as { workoutId: string };
    expect(typeof data.workoutId).toBe('string');
  });

  it('returns error on invalid csvText', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'create_workout_from_csv', {
      csvText: 'Bad CSV Only One Line',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toBeTruthy();
  });
});
