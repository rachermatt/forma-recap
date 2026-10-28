export type ReportingPeriod = { period_start: string; period_end: string };
export function validateReportingPeriod(period: ReportingPeriod): string | null {
  for(const [label,value] of [['start',period.period_start],['end',period.period_end]]) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) return `Enter a valid reporting period ${label} date.`;
  }
  return period.period_start > period.period_end ? 'The reporting period end must be on or after its start. The applied results have not changed.' : null;
}
export const sameReportingPeriod = (a: ReportingPeriod | null, b: ReportingPeriod | null) => a === null ? b === null : !!b && a.period_start===b.period_start && a.period_end===b.period_end;
export const reportingPeriodLabel = (period: ReportingPeriod | null) => period ? `${period.period_start} → ${period.period_end}` : 'All recorded periods';
export function acceptReportingPeriod<T extends {reconciliation_summary:{reporting_period?: ReportingPeriod|null}}>(result:T, requested:ReportingPeriod):T {
  if(!sameReportingPeriod(result.reconciliation_summary.reporting_period || null,requested))throw new Error('The server did not confirm the requested reporting period. The prior applied results remain visible.');
  return result;
}
