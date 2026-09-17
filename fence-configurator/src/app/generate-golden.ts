import { writeFileSync } from 'fs';
import { defaultShape, defaultColorScheme, defaultProfileScheme, heightForBoardCount, FENCE_COLORS } from './defaults';
import { roundToDecimals, formatTrimmed, clampDecimalString } from './utils/numberUtils';

/**
 * Golden-fixture generator for app/defaults.ts + app/utils/numberUtils.ts.
 * Same policy as geometry/generate-golden.ts: run this ONLY after a
 * deliberate, reviewed business-logic change, then diff the result by hand
 * before committing __fixtures__/golden.json.
 */

const out: Record<string, unknown> = {};

out.defaultShape = defaultShape();
out.defaultColorScheme = defaultColorScheme();
out.defaultProfileScheme = defaultProfileScheme();
out.fenceColorsLength = FENCE_COLORS.length;
out.fenceColorsFirst = FENCE_COLORS[0];

out.heightForBoardCount = {
  baseZero_oneBoard: heightForBoardCount(0, 1, 7, 1),
  baseZero_fiveBoards: heightForBoardCount(0, 5, 7, 1),
  baseNonZero_fiveBoards: heightForBoardCount(35, 5, 7, 1),
  boardCountZero_treatedAsOne: heightForBoardCount(0, 0, 7, 1),
  boardCountNegative_treatedAsOne: heightForBoardCount(0, -3, 7, 1),
  differentDims: heightForBoardCount(10, 14, 4, 1),
};

out.roundToDecimals = {
  simple: roundToDecimals(1.2345, 2),
  halfUp: roundToDecimals(0.05, 1),
  zeroDecimals: roundToDecimals(4.7, 0),
  negative: roundToDecimals(-1.2345, 2),
  alreadyExact: roundToDecimals(3, 2),
};

out.formatTrimmed = {
  wholeNumber_noTrailingZeros: formatTrimmed(6, 3),
  oneDecimal_trimsRest: formatTrimmed(6.5, 3),
  exactDecimals_trimsTrailingZero: formatTrimmed(6.1, 3),
  allZerosAfterPoint: formatTrimmed(6.0, 1),
  smallDecimals: formatTrimmed(0.5, 1),
  roundedUp: formatTrimmed(1.999, 2),
};

out.clampDecimalString = {
  noDot_unchanged: clampDecimalString('12', 1),
  withinLimit_unchanged: clampDecimalString('12.3', 1),
  overLimit_truncated: clampDecimalString('12.3456', 1),
  exactlyAtLimit_unchanged: clampDecimalString('12.34', 2),
  dotAtEnd_noDigitsAfter: clampDecimalString('12.', 1),
};

writeFileSync(__dirname + '/__fixtures__/golden.json', JSON.stringify(out, null, 2) + '\n');
console.log('wrote app/__fixtures__/golden.json');
