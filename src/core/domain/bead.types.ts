export const DESIGN_BEADS_FROM_SPEC_TOOL = 'design_beads_from_spec';

export const BEAD_PRIORITIES = ['low', 'medium', 'high'] as const;
export const BEAD_DESIGN_MODES = ['append', 'replace'] as const;

export type BeadPriority = (typeof BEAD_PRIORITIES)[number];
export type BeadDesignMode = (typeof BEAD_DESIGN_MODES)[number];

export interface DesignedBead {
  projectId: string;
  title: string;
  slug: string;
  goal: string;
  scope: string[];
  acceptanceCriteria: string[];
  priority: BeadPriority;
  status: 'pending';
  sourceSpecPath: string;
  beadPath: string;
  outOfScope?: string[];
  dependencies?: string[];
  componentPath?: string;
}

export interface DesignBeadsFromSpecInput {
  projectId: string;
  specPath: string;
  designMode?: BeadDesignMode;
  maxBeads?: number;
  priorityDefault?: BeadPriority;
  componentHint?: string;
}

export interface DesignedBeadResultItem {
  taskId: string;
  title: string;
  priority: BeadPriority;
  status: 'pending';
  beadPath: string;
  componentPath?: string;
}

export interface DesignBeadsFromSpecResult {
  projectId: string;
  specPath: string;
  designMode: BeadDesignMode;
  createdCount: number;
  replacedCount?: number;
  beads: DesignedBeadResultItem[];
  warnings: string[];
  success: boolean;
}

export function normalizeBeadPriority(value?: string | null): BeadPriority {
  if (!value) return 'medium';

  const normalized = value.trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }

  return 'medium';
}

export function normalizeBeadDesignMode(value?: string | null): BeadDesignMode {
  if (!value) return 'append';

  const normalized = value.trim().toLowerCase();
  return normalized === 'replace' ? 'replace' : 'append';
}

export function slugifyBeadTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function buildBeadFileName(sequence: number, title: string) {
  const clampedSequence = Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1;
  const slug = slugifyBeadTitle(title) || 'untitled';
  const index = String(clampedSequence).padStart(2, '0');

  return `bead-${index}-${slug}.md`;
}
