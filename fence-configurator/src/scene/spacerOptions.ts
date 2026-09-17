export interface SpacerOption {
  label: string;
  value: number;
}

/**
 * The only valid spacer multipliers. Confirmed with the client, 2026-09:
 * there is no "half" spacer — some real installs instead close a field
 * with a ZERO spacer at one step. Renamed from the earlier
 * half/normal/double (0.5/1/2) set accordingly.
 *
 * Shared between the picker UI (App.tsx's spacer carousel) and the
 * step-fallback search (resolveBoardStepCandidates) so the two can never
 * drift apart — a value added here for the picker is automatically also
 * tried by the fallback search, and vice versa.
 */
export const SPACER_OPTIONS: SpacerOption[] = [
  { label: 'אפס', value: 0 },
  { label: 'רגיל', value: 1 },
  { label: 'כפול', value: 2 },
];
