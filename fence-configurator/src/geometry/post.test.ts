import { describe, it, expect } from 'vitest';
import { faceForDirection, activeGrooveFaces, buildPostSpec } from './post';
import golden from './__fixtures__/golden.json';

/** See shape.test.ts's header comment — same golden-baseline policy applies here. */

describe('faceForDirection — golden baseline', () => {
  it('same heading as the post -> posX', () => {
    expect(faceForDirection(0, 0)).toBe(golden.faceForDirection.same);
  });
  it('+90° relative -> posZ', () => {
    expect(faceForDirection(0, Math.PI / 2)).toBe(golden.faceForDirection.plus90);
  });
  it('+180° relative -> negX', () => {
    expect(faceForDirection(0, Math.PI)).toBe(golden.faceForDirection.plus180);
  });
  it('+270° relative -> negZ', () => {
    expect(faceForDirection(0, (3 * Math.PI) / 2)).toBe(golden.faceForDirection.plus270);
  });
  it('negative relative angle wraps correctly', () => {
    expect(faceForDirection(Math.PI / 2, 0)).toBe(golden.faceForDirection.negativeRel);
  });
  it('non-zero post heading, +90° relative', () => {
    expect(faceForDirection(Math.PI, (3 * Math.PI) / 2)).toBe(golden.faceForDirection.nonZeroPostHeading_plus90);
  });
});

describe('activeGrooveFaces — golden baseline', () => {
  it('true end post, rosetteEnd start -> one face, forward', () => {
    expect(activeGrooveFaces({ postHeadingRad: 0, legIndices: [0], rosetteEnd: 'start' })).toEqual(
      golden.activeGrooveFaces.trueEndPost_start,
    );
  });
  it('true end post, rosetteEnd end -> one face, backward', () => {
    expect(activeGrooveFaces({ postHeadingRad: 0, legIndices: [0], rosetteEnd: 'end' })).toEqual(
      golden.activeGrooveFaces.trueEndPost_end,
    );
  });
  it('internal within-leg split post -> two opposite faces', () => {
    expect(activeGrooveFaces({ postHeadingRad: 0, legIndices: [0] })).toEqual(golden.activeGrooveFaces.internalSplitPost);
  });
  it('double post, straight junction -> two opposite faces (boards continue in the same direction)', () => {
    expect(
      activeGrooveFaces({ postHeadingRad: 0, legIndices: [0, 1], isDoublePost: true, outgoingHeadingRad: 0 }),
    ).toEqual(golden.activeGrooveFaces.doublePost_straight);
  });
  it('double post, left corner -> two PERPENDICULAR faces', () => {
    expect(
      activeGrooveFaces({
        postHeadingRad: 0,
        legIndices: [0, 1],
        isDoublePost: true,
        outgoingHeadingRad: Math.PI / 2,
      }),
    ).toEqual(golden.activeGrooveFaces.doublePost_leftCorner);
  });
  it('double post, right corner -> two PERPENDICULAR faces, mirrored from left', () => {
    expect(
      activeGrooveFaces({
        postHeadingRad: 0,
        legIndices: [0, 1],
        isDoublePost: true,
        outgoingHeadingRad: -Math.PI / 2,
      }),
    ).toEqual(golden.activeGrooveFaces.doublePost_rightCorner);
  });
});

describe('buildPostSpec — golden baseline', () => {
  it('maps active faces to one groove spec each, fixed width/depth', () => {
    const faces = activeGrooveFaces({ postHeadingRad: 0, legIndices: [0] });
    expect(buildPostSpec(180, faces)).toEqual(golden.buildPostSpec);
  });
});

describe('post geometry — invariants', () => {
  it('a corner double post never returns opposite faces (that would be a straight junction, not a corner)', () => {
    const faces = activeGrooveFaces({
      postHeadingRad: 0,
      legIndices: [0, 1],
      isDoublePost: true,
      outgoingHeadingRad: Math.PI / 2,
    });
    expect(faces).toHaveLength(2);
    // opposite faces would be posX/negX or posZ/negZ — a corner must NOT be either pair
    const isOppositePair =
      (faces.includes('posX') && faces.includes('negX')) || (faces.includes('posZ') && faces.includes('negZ'));
    expect(isOppositePair).toBe(false);
  });

  it('buildPostSpec never invents a groove on a face that was not requested', () => {
    const faces = activeGrooveFaces({ postHeadingRad: 0, legIndices: [0], rosetteEnd: 'start' });
    const spec = buildPostSpec(180, faces);
    expect(spec.grooves).toHaveLength(faces.length);
  });
});
