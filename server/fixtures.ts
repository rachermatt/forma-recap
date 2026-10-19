/** Synthetic local-only records. These identifiers are never APS identifiers. */
export const fixtureReviewer = { id: 'fixture-reviewer', name: 'Local fixture reviewer' } as const;

export const fixtureProject = {
  id: 'fixture-project', name: 'Northbank Research Center', hub_id: 'fixture-hub', mode: 'fixture',
} as const;

export const fixtureModel = {
  id: 'fixture-model', name: 'Mechanical coordination', version_id: 'fixture-model-v7', version_label: 'Version 7',
  elements: [
    { external_id: 'DUCT-01', label: 'Main supply duct', zone_id: 'zone-east' },
    { external_id: 'DUCT-02', label: 'East branch duct', zone_id: 'zone-east' },
    { external_id: 'DUCT-03', label: 'Terminal connection', zone_id: 'zone-east' },
  ],
} as const;

export const fixtureScope = {
  scope_id: 'fixture-scope', revision: 1, trade: 'Ductwork', zone_id: 'zone-east', floor: 'Level 02',
  name: 'East wing · supply air', element_ids: ['DUCT-01', 'DUCT-02', 'DUCT-03'],
  created_by: fixtureReviewer.id, model_version_id: fixtureModel.version_id,
  mapping_method: 'explicit_manual_element_selection',
  mapping_rationale: 'Synthetic demonstration scope: three named duct elements in the east wing.',
} as const;

export const fixturePlan = {
  file_id: 'fixture-plan', version_id: 'fixture-plan-v3', name: 'Level 02 · Mechanical plan',
  url: '/api/media/fixture-plan',
} as const;

export const fixtureMedia = [
  { id: 'fixture-plan', file: 'fixture-plan.svg', contentType: 'image/svg+xml' },
  { id: 'fixture-capture-01', file: 'fixture-capture-01.svg', contentType: 'image/svg+xml' },
  { id: 'fixture-capture-02', file: 'fixture-capture-02.svg', contentType: 'image/svg+xml' },
] as const;

export const fixtureCaptures = [
  {
    capture_id: 'fixture-capture-01', title: 'East corridor · October 8',
    capture_ref: {
      capture_id: 'fixture-capture-01', content_sha256: null as string | null,
      captured_at: null, captured_date: '2026-10-08', date_precision: 'date', date_source: 'fixture',
      original_timezone: null, uploaded_at: '2026-10-09T14:05:00Z',
    },
    media_url: '/api/media/fixture-capture-01',
    placement: {
      method: 'manual_plan_pin',
      plan_ref: { file_id: fixturePlan.file_id, version_id: fixturePlan.version_id },
      normalized_pin: { x: 0.37, y: 0.48, origin: 'top_left' }, is_verified_3d_registration: false,
    },
    source_context: 'Synthetic SVG illustration; no customer imagery, actual site observation, or camera pose.',
  },
  {
    capture_id: 'fixture-capture-02', title: 'East corridor · October 15',
    capture_ref: {
      capture_id: 'fixture-capture-02', content_sha256: null as string | null,
      captured_at: '2026-10-15T10:20:00-04:00', captured_date: '2026-10-15', date_precision: 'timestamp',
      date_source: 'fixture', original_timezone: 'America/New_York', uploaded_at: '2026-10-16T14:00:00Z',
    },
    media_url: '/api/media/fixture-capture-02',
    placement: {
      method: 'manual_plan_pin',
      plan_ref: { file_id: fixturePlan.file_id, version_id: fixturePlan.version_id },
      normalized_pin: { x: 0.41, y: 0.51, origin: 'top_left' }, is_verified_3d_registration: false,
    },
    source_context: 'Synthetic SVG illustration; no customer imagery, actual site observation, or camera pose.',
  },
] as const;
