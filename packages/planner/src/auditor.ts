import type { AuditResult, WeekPlan, PlanSpec } from './types.js';

export async function auditPlan(
  weeks: WeekPlan[],
  spec: PlanSpec,
  apiKey: string,
): Promise<AuditResult> {
  const weekSummaries = weeks.map(w => ({
    week: w.weekNum,
    phase: w.phase,
    tss: w.tss,
  }));

  const hoursPerWeek = estimateHoursPerWeek(spec);

  const prompt = `You are a triathlon coach auditing a training plan. Return ONLY valid JSON, no explanation.

Race: ${spec.raceType}, ${weeks.length} weeks of preparation.
Athlete CTL baseline: ${spec.ctlBaseline}. Available hours per week: ~${hoursPerWeek.toFixed(1)}h.
Plan weeks: ${JSON.stringify(weekSummaries)}

Return: {"summary":"<2-3 sentence plan overview>","warnings":[{"severity":"error"|"warning","message":"<concise issue>"}]}

Only include warnings for real issues:
- Timeline under minimum (sprint<4w, olympic<8w, 703<12w, full<16w, half-marathon<8w)
- Any week-over-week TSS increase >15% (excluding recovery→build transitions)
- Available hours likely insufficient for peak TSS weeks
- Taper shorter than 1 week

Return empty warnings array if plan looks solid.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);

  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = data.content.find(b => b.type === 'text')?.text ?? '';

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as AuditResult;
}

function estimateHoursPerWeek(spec: PlanSpec): number {
  let totalMin = 0;
  const sports = ['swim', 'bike', 'run'] as const;
  for (const sport of sports) {
    const sportGrid = spec.grid[sport];
    if (!sportGrid) continue;
    for (const cell of Object.values(sportGrid)) {
      if (!cell.intensity) continue;
      const mins = { short: 45, moderate: 75, long: 150 }[cell.intensity];
      totalMin += mins;
    }
  }
  return totalMin / 60;
}
