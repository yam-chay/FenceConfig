export interface SpacerOption {
  label: string;
  value: number;
}

/**
 * The only valid spacer multipliers. Confirmed with the client, 2026-09:
 * there is no "half" spacer — some real installs instead close a field
 * with a ZERO spacer at one step.
 *
 * Moved from scene/ to geometry/ so closure.ts can reach it without the
 * geometry layer depending on the scene layer. scene/spacerOptions.ts is
 * now a re-export barrel, so every existing import keeps working.
 */
export const SPACER_OPTIONS: SpacerOption[] = [
  { label: 'אפס', value: 0 },
  { label: 'רגיל', value: 1 },
  { label: 'כפול', value: 2 },
];