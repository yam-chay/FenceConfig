import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Shape, Leg, Junction } from '../../geometry/shape';
import { fieldCountForLeg } from '../../geometry/shape';
import { computeBoardStack } from '../../geometry/field';
import { DEFAULT_MODEL_ID, DEFAULT_SIZE_ID } from '../../geometry/catalog';
import type { ColorScheme, ProfileScheme, Selection, BoardColorRule, BoardProfileRule, SpacerRule } from '../../scene/Scene';
import {
  resolveBoardColorHex,
  resolveBoardProfile,
  resolveSpacerMultiplier,
  resolveBoardStepCandidates,
} from '../../scene/Scene';
import { FENCE_COLORS } from '../defaults';

/**
 * All 18 shape/color/profile edit actions, plus the "apply to entire fence"
 * toast mechanism, extracted from App(). One hook (not split into
 * shapeActions/colorActions/profileActions/fieldActions as the refactor
 * plan's literal file names suggested) because these functions call each
 * other across those conceptual boundaries — updateLegLength and addLeg
 * both call cloneFieldProfileRules, for instance. Splitting further would
 * mean passing functions between hooks as parameters instead of just
 * calling them directly; keeping them together avoids that extra wiring.
 *
 * shape/colorScheme/profileScheme themselves stay owned by App() (Scene
 * needs them as direct props) — this hook only receives them + their
 * setters, same pattern as useHistory. It DOES own the "pending picker"
 * state (pendingBoardColor, pendingModelId, pendingSizeId, pendingSpacer,
 * applyToAllFields) and the apply-to-fence toast state internally, since
 * nothing outside fence editing touches them.
 */
export function useFenceEditor(
  shape: Shape,
  setShape: Dispatch<SetStateAction<Shape>>,
  colorScheme: ColorScheme,
  setColorScheme: Dispatch<SetStateAction<ColorScheme>>,
  profileScheme: ProfileScheme,
  setProfileScheme: Dispatch<SetStateAction<ProfileScheme>>,
  selection: Selection | null,
  setExpandedLegIndices: Dispatch<SetStateAction<Set<number>>>,
  undo: () => void,
) {
  const [pendingBoardColor, setPendingBoardColor] = useState(FENCE_COLORS[0].hex);
  const [pendingModelId, setPendingModelId] = useState(DEFAULT_MODEL_ID);
  const [pendingSizeId, setPendingSizeId] = useState(DEFAULT_SIZE_ID);
  const [pendingSpacer, setPendingSpacer] = useState(1);
  const [applyToAllFields, setApplyToAllFields] = useState(false);

  // "החל על כל הגדר" feedback: a toast with an immediate undo (which just
  // calls the existing undo() below — the action already lands as one
  // normal history entry, same as any other edit), an extra clarification
  // line shown only the first time it's ever used this session, and a brief
  // pulse on the corner undo button run in parallel with the toast.
  const [applyFenceToast, setApplyFenceToast] = useState<{ showHint: boolean } | null>(null);
  const [hasShownApplyFenceHint, setHasShownApplyFenceHint] = useState(false);
  const [undoPulse, setUndoPulse] = useState(false);
  const applyFenceToastTimeoutRef = useRef<number | null>(null);
  const undoPulseTimeoutRef = useRef<number | null>(null);

  function updateLeg(legIndex: number, updater: (leg: Leg) => Leg) {
    setShape((prev) => ({
      ...prev,
      legs: prev.legs.map((leg, i) => (i === legIndex ? updater(leg) : leg)),
    }));
  }

  // Which of this leg's own two ends is a shared "middle" post (boards
  // emerge from both faces — a straight/left/right junction to a
  // neighboring leg) vs. a true "end" post (one face only — either edge of
  // the whole shape, or either side of a 'disconnect') decides its segment
  // margin in the real field-count formula. Same split shape.ts's
  // layoutShape already uses to decide isDoublePost.
  function fieldCountForLegAt(legIndex: number, lengthM: number): number {
    const startIsMiddle = legIndex > 0 && shape.junctions[legIndex - 1]?.type !== 'disconnect';
    const endIsMiddle = legIndex < shape.legs.length - 1 && shape.junctions[legIndex]?.type !== 'disconnect';
    return fieldCountForLeg(lengthM, startIsMiddle, endIsMiddle);
  }

  // Length is the only leg input that changes how many fields the leg
  // splits into — when it grows past a split point, every NEW field starts
  // as a copy of the previous last field's pattern (confirmed behavior).
  function updateLegLength(legIndex: number, newLengthM: number) {
    const oldCount = fieldCountForLegAt(legIndex, shape.legs[legIndex].lengthM);
    const newCount = fieldCountForLegAt(legIndex, newLengthM);
    updateLeg(legIndex, (l) => ({ ...l, lengthM: newLengthM }));
    if (newCount > oldCount) {
      const newIndexes: number[] = [];
      for (let f = oldCount; f < newCount; f++) newIndexes.push(f);
      cloneFieldProfileRules(legIndex, oldCount - 1, legIndex, newIndexes);
    }
  }

  function setJunction(junctionIndex: number, type: Junction['type']) {
    setShape((prev) => ({
      ...prev,
      junctions: prev.junctions.map((j, i) => (i === junctionIndex ? { type } : j)),
    }));
  }

  function addLeg() {
    const lastLegIndex = shape.legs.length - 1;
    const lastLeg = shape.legs[lastLegIndex];
    const lastFieldIndex = fieldCountForLegAt(lastLegIndex, lastLeg.lengthM) - 1;
    setShape((prev) => {
      const last = prev.legs[prev.legs.length - 1];
      return {
        legs: [
          ...prev.legs,
          {
            lengthM: 3,
            baseHeightCm: last.baseHeightCm,
            heightCm: last.heightCm,
            modelId: last.modelId,
            sizeId: last.sizeId,
            wallWidthCm: last.wallWidthCm,
          },
        ],
        junctions: [...prev.junctions, { type: 'straight' }],
      };
    });
    // New leg = continuation of the shape: its fields inherit the pattern
    // of the field they extend from (the previous leg's last field). The
    // new leg's own start is a middle post (it's about to be joined to
    // lastLeg by a 'straight' junction above) and its end is a true shape
    // end (nothing after it yet) — can't use fieldCountForLegAt here since
    // this leg doesn't exist in `shape` yet.
    const newLegFieldCount = fieldCountForLeg(3, true, false);
    const newIndexes: number[] = [];
    for (let f = 0; f < newLegFieldCount; f++) newIndexes.push(f);
    cloneFieldProfileRules(lastLegIndex, lastFieldIndex, lastLegIndex + 1, newIndexes);
    // Accordion, not a pile-up: closes whatever was open and opens only
    // the leg just added, so the panel never shows more than one
    // expanded leg at a time — keeps the order readable as the shape
    // grows instead of leaving every past leg expanded underneath.
    setExpandedLegIndices(new Set([lastLegIndex + 1]));
  }

  // Symmetric to addLeg(), but at the FRONT — "start the fence from the
  // middle" use case. The tricky part: prepending shifts every EXISTING
  // leg's index by +1, but every stored field-scoped rule (color/profile/
  // spacer) carries a plain legIndex NUMBER, not a stable identity — so
  // every one of them has to be re-pointed to legIndex+1 too, BEFORE the
  // shape itself changes, or a rule that said "leg 2" would silently keep
  // saying "leg 2" while leg 2 is now a completely different physical leg.
  // Global-scoped rules are untouched — they were never leg-specific.
  //
  // Known gap, not handled here yet: per-leg UI-only state that isn't
  // routed through this hook — lengthPrecision/baseHeightPrecision (fine-
  // adjustment toggles, live in App.tsx) and the current `selection` — can
  // end up pointing at the wrong leg after a prepend. Cosmetic, not data
  // loss (nothing here can corrupt geometry beyond a stale fine-precision
  // readout), but real; flag if it needs fixing too.
  function addLegAtStart() {
    setColorScheme((prev) => ({
      ...prev,
      boardRules: prev.boardRules.map((r) => (r.scope === 'field' ? { ...r, legIndex: r.legIndex! + 1 } : r)),
    }));
    setProfileScheme((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.scope === 'field' ? { ...r, legIndex: r.legIndex! + 1 } : r)),
      spacerRules: prev.spacerRules.map((r) => (r.scope === 'field' ? { ...r, legIndex: r.legIndex! + 1 } : r)),
    }));

    setShape((prev) => {
      const first = prev.legs[0];
      return {
        legs: [
          {
            lengthM: 3,
            baseHeightCm: first.baseHeightCm,
            heightCm: first.heightCm,
            modelId: first.modelId,
            sizeId: first.sizeId,
            wallWidthCm: first.wallWidthCm,
          },
          ...prev.legs,
        ],
        junctions: [{ type: 'straight' }, ...prev.junctions],
      };
    });
    // Mirrors addLeg(): the new leg's fields inherit the pattern of the
    // field they extend INTO — what was field 0 of what was leg 0, which
    // is now leg 1 (its own rules were just shifted to legIndex+1 above,
    // so this agrees with that same post-prepend numbering). The new
    // leg's own start is a true shape end (nothing before it) and its
    // end is a middle post (about to be joined to the old leg 0 by the
    // 'straight' junction above) — can't use fieldCountForLegAt here
    // since this leg doesn't exist in `shape` yet.
    const newLegFieldCount = fieldCountForLeg(3, false, true);
    const newIndexes: number[] = [];
    for (let f = 0; f < newLegFieldCount; f++) newIndexes.push(f);
    cloneFieldProfileRules(1, 0, 0, newIndexes);
    // Same "accordion, not a pile-up" behavior as addLeg().
    setExpandedLegIndices(new Set([0]));
  }

  function removeLastLeg() {
    const removedIndex = shape.legs.length - 1;
    setShape((prev) => {
      if (prev.legs.length <= 1) return prev;
      return { legs: prev.legs.slice(0, -1), junctions: prev.junctions.slice(0, -1) };
    });
    setExpandedLegIndices((prev) => {
      if (!prev.has(removedIndex)) return prev;
      const next = new Set(prev);
      next.delete(removedIndex);
      return next;
    });
  }

  function setPostColor(hex: string) {
    setColorScheme((prev) => ({ ...prev, postColorHex: hex }));
  }

  // Appends one rule — later rules override earlier ones for any board
  // both match, so "last action wins" just falls out of insertion order.
  // scope follows the "apply to all fields" toggle: field-scoped by
  // default (just the column between the 2 posts you clicked in), global
  // only when explicitly asked for.
  function addColorRule(direction: 'exact' | 'below' | 'above', stepIndex: number, colorHex: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setColorScheme((prev) => ({
      ...prev,
      boardRules: [
        ...prev.boardRules,
        applyToAllFields
          ? { stepIndex, colorHex, direction, scope: 'global' as const }
          : { stepIndex, colorHex, direction, scope: 'field' as const, legIndex, fieldIndex },
      ],
    }));
  }

  // Paints every step in a multi-selection at once, one rule per step (each
  // keyed by ITS OWN height — color is height-keyed, and mixed-profile steps
  // don't share a height, so the anchor's height alone isn't enough here).
  function addColorRuleForSteps(stepIndices: number[], colorHex: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setColorScheme((prev) => ({
      ...prev,
      boardRules: [
        ...prev.boardRules,
        ...stepIndices.map((stepIndex) =>
          applyToAllFields
            ? { stepIndex, colorHex, direction: 'exact' as const, scope: 'global' as const }
            : { stepIndex, colorHex, direction: 'exact' as const, scope: 'field' as const, legIndex, fieldIndex },
        ),
      ],
    }));
  }

  // Clicking a swatch paints the whole current selection immediately — a
  // single step by default, every step in a range/multi-selection when one
  // is active. below/above are follow-up actions to extend from the edges
  // of that selection, not required first steps.
  function pickBoardColor(hex: string) {
    setPendingBoardColor(hex);
    if (selection?.kind === 'board') {
      addColorRuleForSteps(selection.stepIndices, hex);
    }
  }

  // Same shape as addColorRule, one rule type over — but keyed on STEP
  // INDEX, not height (height circularly depends on the types being
  // resolved; index is just the stacking counter). Field-scoped by default,
  // global only when "apply to all fields" is on, later rules win.
  function addProfileRule(direction: 'exact' | 'below' | 'above', stepIndex: number, modelId: string, sizeId: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      rules: [
        ...prev.rules,
        applyToAllFields
          ? { stepIndex, modelId, sizeId, direction, scope: 'global' as const }
          : { stepIndex, modelId, sizeId, direction, scope: 'field' as const, legIndex, fieldIndex },
      ],
    }));
  }

  // Same idea as addColorRuleForSteps: one 'exact' rule per selected step —
  // trivial here since profile is index-keyed, no per-step lookup needed.
  function addProfileRuleForSteps(stepIndices: number[], modelId: string, sizeId: string) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      rules: [
        ...prev.rules,
        ...stepIndices.map((stepIndex) =>
          applyToAllFields
            ? { stepIndex, modelId, sizeId, direction: 'exact' as const, scope: 'global' as const }
            : { stepIndex, modelId, sizeId, direction: 'exact' as const, scope: 'field' as const, legIndex, fieldIndex },
        ),
      ],
    }));
  }

  // A newly created field starts as a continuation of its neighbor: copy
  // every field-scoped profile rule from the source field onto each new
  // field index. Confirmed behavior — "design one field, then extend and
  // the design travels with you", which the interactive tutorial will lean
  // on as the intended flow.
  function cloneFieldProfileRules(
    fromLegIndex: number,
    fromFieldIndex: number,
    toLegIndex: number,
    toFieldIndexes: number[],
  ) {
    if (toFieldIndexes.length === 0) return;
    setProfileScheme((prev) => {
      const sourceRules = prev.rules.filter(
        (r) => r.scope === 'field' && r.legIndex === fromLegIndex && r.fieldIndex === fromFieldIndex,
      );
      const sourceSpacers = prev.spacerRules.filter(
        (r) => r.scope === 'field' && r.legIndex === fromLegIndex && r.fieldIndex === fromFieldIndex,
      );
      if (sourceRules.length === 0 && sourceSpacers.length === 0) return prev;
      const clonedRules = toFieldIndexes.flatMap((fieldIndex) =>
        sourceRules.map((r) => ({ ...r, legIndex: toLegIndex, fieldIndex })),
      );
      const clonedSpacers = toFieldIndexes.flatMap((fieldIndex) =>
        sourceSpacers.map((r) => ({ ...r, legIndex: toLegIndex, fieldIndex })),
      );
      return { ...prev, rules: [...prev.rules, ...clonedRules], spacerRules: [...prev.spacerRules, ...clonedSpacers] };
    });
  }

  // Spacer sizing (advanced): a multiplier on the spacer BELOW a step,
  // through the exact same rule machinery — immediate on the clicked step,
  // below/above as follow-ups, same "apply to all fields" scope.
  function addSpacerRule(direction: 'exact' | 'below' | 'above', stepIndex: number, multiplier: number) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      spacerRules: [
        ...prev.spacerRules,
        applyToAllFields
          ? { stepIndex, multiplier, direction, scope: 'global' as const }
          : { stepIndex, multiplier, direction, scope: 'field' as const, legIndex, fieldIndex },
      ],
    }));
  }

  function addSpacerRuleForSteps(stepIndices: number[], multiplier: number) {
    if (selection?.kind !== 'board') return;
    const { legIndex, fieldIndex } = selection;
    setProfileScheme((prev) => ({
      ...prev,
      spacerRules: [
        ...prev.spacerRules,
        ...stepIndices.map((stepIndex) =>
          applyToAllFields
            ? { stepIndex, multiplier, direction: 'exact' as const, scope: 'global' as const }
            : { stepIndex, multiplier, direction: 'exact' as const, scope: 'field' as const, legIndex, fieldIndex },
        ),
      ],
    }));
  }

  function pickSpacer(multiplier: number) {
    setPendingSpacer(multiplier);
    if (selection?.kind === 'board') {
      addSpacerRuleForSteps(selection.stepIndices, multiplier);
    }
  }

  // Picking a model resets to that model's first size — same reasoning as
  // the leg-level "סוג"/"גודל" carousels: a size only makes sense for the
  // model it belongs to.
  function pickBoardProfile(modelId: string, sizeId: string) {
    setPendingModelId(modelId);
    setPendingSizeId(sizeId);
    if (selection?.kind === 'board') {
      addProfileRuleForSteps(selection.stepIndices, modelId, sizeId);
    }
  }

  // Explicit escape hatch: a field with ANY field-scoped profile rule stays
  // deaf to the leg's own bootstrap default (no longer user-facing, but
  // still resolveBoardProfile's fallback) for whatever height range that
  // rule covers — even if you've since repainted every step back to the
  // same type, since that's still explicit rules, not "no rules".
  // Repainting to look uniform again doesn't undo that; this does, on
  // purpose, rather than guessing from the resolved colors/types whether a
  // field "counts" as still customized.
  function clearFieldProfile(legIndex: number, fieldIndex: number) {
    setProfileScheme((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => !(r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex)),
      spacerRules: prev.spacerRules.filter(
        (r) => !(r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex),
      ),
    }));
    // Color rules were never cleared here originally — a field with ONLY a
    // color customization (no profile/spacer rule) silently kept its color
    // after "restore default", and the button stayed disabled for it too
    // (see selectedFieldHasCustomizations in App.tsx). Both fixed together.
    setColorScheme((prev) => ({
      ...prev,
      boardRules: prev.boardRules.filter(
        (r) => !(r.scope === 'field' && r.legIndex === legIndex && r.fieldIndex === fieldIndex),
      ),
    }));
  }

  function showApplyFenceToast() {
    const showHint = !hasShownApplyFenceHint;
    if (showHint) setHasShownApplyFenceHint(true);
    setApplyFenceToast({ showHint });
    if (applyFenceToastTimeoutRef.current) window.clearTimeout(applyFenceToastTimeoutRef.current);
    applyFenceToastTimeoutRef.current = window.setTimeout(() => setApplyFenceToast(null), 6000);

    setUndoPulse(true);
    if (undoPulseTimeoutRef.current) window.clearTimeout(undoPulseTimeoutRef.current);
    undoPulseTimeoutRef.current = window.setTimeout(() => setUndoPulse(false), 700);
  }

  function undoApplyFenceToast() {
    undo();
    setApplyFenceToast(null);
    if (applyFenceToastTimeoutRef.current) window.clearTimeout(applyFenceToastTimeoutRef.current);
  }

  // "החל על כל הגדר": copies the SINGLE field currently open in the sheet —
  // every one of its steps' color, profile and spacer — one-to-one by step
  // index, onto every OTHER field in the project. Independent of each
  // attribute's own "החל על כל השדות" checkbox. Never touches any leg's own
  // length/height. A taller/shorter target field just fills/stops per the
  // normal computeBoardStack rule (closest whole board, no cutting) — steps
  // beyond what the source had simply aren't written, so they fall back to
  // that leg's own default the same as any untouched field.
  //
  // Color is step-indexed now too (same as profile/spacer — see
  // BoardColorRule in scene/types.ts), so this is a straight 1:1 copy by
  // stepIndex, no height re-keying needed.
  function applyFieldToEntireFence() {
    if (selection?.kind !== 'board') return;
    const { legIndex: sourceLegIndex, fieldIndex: sourceFieldIndex } = selection;
    const sourceLeg = shape.legs[sourceLegIndex];
    const sourceFillHeightCm = sourceLeg.heightCm - sourceLeg.baseHeightCm;

    const sourceStack = computeBoardStack(sourceFillHeightCm, (stepIndex) =>
      resolveBoardStepCandidates(profileScheme, sourceLegIndex, sourceFieldIndex, stepIndex, sourceLeg.modelId, sourceLeg.sizeId),
    );

    if (sourceStack.boards.length === 0) return;

    const newProfileRules: BoardProfileRule[] = [];
    const newSpacerRules: SpacerRule[] = [];
    const newColorRules: BoardColorRule[] = [];

    shape.legs.forEach((targetLeg, targetLegIndex) => {
      const targetFieldCount = fieldCountForLegAt(targetLegIndex, targetLeg.lengthM);
      for (let targetFieldIndex = 0; targetFieldIndex < targetFieldCount; targetFieldIndex++) {
        if (targetLegIndex === sourceLegIndex && targetFieldIndex === sourceFieldIndex) continue;
        for (const board of sourceStack.boards) {
          newProfileRules.push({
            stepIndex: board.stepIndex,
            modelId: board.modelId,
            sizeId: board.sizeId,
            direction: 'exact',
            scope: 'field',
            legIndex: targetLegIndex,
            fieldIndex: targetFieldIndex,
          });
          newSpacerRules.push({
            stepIndex: board.stepIndex,
            multiplier: resolveSpacerMultiplier(profileScheme, sourceLegIndex, sourceFieldIndex, board.stepIndex),
            direction: 'exact',
            scope: 'field',
            legIndex: targetLegIndex,
            fieldIndex: targetFieldIndex,
          });
          const colorHex = resolveBoardColorHex(colorScheme, sourceLegIndex, sourceFieldIndex, board.stepIndex);
          newColorRules.push({
            stepIndex: board.stepIndex,
            colorHex,
            direction: 'exact',
            scope: 'field',
            legIndex: targetLegIndex,
            fieldIndex: targetFieldIndex,
          });
        }
      }
    });

    setProfileScheme((prev) => ({
      ...prev,
      rules: [...prev.rules, ...newProfileRules],
      spacerRules: [...prev.spacerRules, ...newSpacerRules],
    }));
    setColorScheme((prev) => ({ ...prev, boardRules: [...prev.boardRules, ...newColorRules] }));

    showApplyFenceToast();
  }

  // Seed the pickers with the CLICKED board's actual current color, profile
  // and spacer, instead of leaving whatever was last picked for a different
  // board — that staleness was its own source of "why did it apply the
  // wrong thing". Profile falls back to the leg's own model/size, same
  // fallback resolveBoardProfile itself uses when no rule matches yet.
  useEffect(() => {
    if (selection?.kind === 'board') {
      setPendingBoardColor(resolveBoardColorHex(colorScheme, selection.legIndex, selection.fieldIndex, selection.stepIndex));
      const leg = shape.legs[selection.legIndex];
      const resolved = resolveBoardProfile(
        profileScheme,
        selection.legIndex,
        selection.fieldIndex,
        selection.stepIndex,
        leg.modelId,
        leg.sizeId,
      );
      setPendingModelId(resolved.modelId);
      setPendingSizeId(resolved.sizeId);
      setPendingSpacer(
        resolveSpacerMultiplier(profileScheme, selection.legIndex, selection.fieldIndex, selection.stepIndex),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  return {
    updateLeg,
    updateLegLength,
    setJunction,
    addLeg,
    addLegAtStart,
    removeLastLeg,
    setPostColor,
    addColorRule,
    pickBoardColor,
    addProfileRule,
    addSpacerRule,
    pickSpacer,
    pickBoardProfile,
    clearFieldProfile,
    applyFieldToEntireFence,
    undoApplyFenceToast,
    pendingBoardColor,
    pendingModelId,
    pendingSizeId,
    pendingSpacer,
    applyToAllFields,
    setApplyToAllFields,
    applyFenceToast,
    undoPulse,
  };
}