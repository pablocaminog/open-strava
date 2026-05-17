import type { AuditResult, WeekPlan, PlanSpec } from './types.js';
export async function auditPlan(_weeks: WeekPlan[], _spec: PlanSpec, _apiKey: string): Promise<AuditResult> { return { summary: '', warnings: [] }; }
