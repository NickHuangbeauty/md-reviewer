// Canary Assertions for Diff Engine Integrity
// Validates edit arrays and statistics after every diff computation.
// Always-on: O(n) single pass, negligible overhead vs O(n*m) diff.

const VALID_EDIT_TYPES = new Set(['add', 'del', 'modify', 'eq']);

/**
 * Validate the edit array produced by the diff engine.
 * @param {Array} edits - Array of edit objects
 * @returns {{ violations: Array<{level:string, code:string, message:string}>, suspicious: Array<{code:string, message:string}> }}
 */
export function validateEdits(edits) {
  const violations = [];
  const suspicious = [];

  if (!Array.isArray(edits)) {
    violations.push({ level: 'error', code: 'EDITS_NOT_ARRAY', message: 'edits is not an array' });
    return { violations, suspicious };
  }

  const seenOldIdx = new Set();
  const seenNewIdx = new Set();
  let modifiedCount = 0;
  let totalSimilarity = 0;

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];

    // INV-1: Every edit has a valid type
    if (!e || !VALID_EDIT_TYPES.has(e.type)) {
      violations.push({ level: 'error', code: 'INVALID_EDIT_TYPE', message: `Edit[${i}] invalid type: ${e?.type}` });
      continue;
    }

    // INV-2: Required fields per type
    if (e.type === 'add' && e.newLine === undefined) {
      violations.push({ level: 'error', code: 'ADD_MISSING_FIELDS', message: `Edit[${i}] type=add missing newLine` });
    }
    if (e.type === 'del' && e.oldLine === undefined) {
      violations.push({ level: 'error', code: 'DEL_MISSING_FIELDS', message: `Edit[${i}] type=del missing oldLine` });
    }
    if (e.type === 'modify') {
      if (e.oldLine === undefined || e.newLine === undefined) {
        violations.push({ level: 'error', code: 'MODIFY_MISSING_FIELDS', message: `Edit[${i}] type=modify missing oldLine or newLine` });
      }
      modifiedCount++;
      totalSimilarity += (e.similarity ?? 0.6);
    }
    if (e.type === 'eq') {
      if (e.oldLine === undefined || e.newLine === undefined) {
        violations.push({ level: 'error', code: 'EQ_MISSING_FIELDS', message: `Edit[${i}] type=eq missing oldLine or newLine` });
      }
    }

    // INV-3: No duplicate line indices
    if (e.oldIdx !== undefined) {
      if (seenOldIdx.has(e.oldIdx)) {
        violations.push({ level: 'warn', code: 'DUP_OLD_IDX', message: `Edit[${i}] duplicate oldIdx: ${e.oldIdx}` });
      }
      seenOldIdx.add(e.oldIdx);
    }
    if (e.newIdx !== undefined) {
      if (seenNewIdx.has(e.newIdx)) {
        violations.push({ level: 'warn', code: 'DUP_NEW_IDX', message: `Edit[${i}] duplicate newIdx: ${e.newIdx}` });
      }
      seenNewIdx.add(e.newIdx);
    }
  }

  // ANOMALY-1: All lines are "modified" with low average similarity
  if (modifiedCount > 0 && modifiedCount === edits.length) {
    const avgSim = totalSimilarity / modifiedCount;
    if (avgSim < 0.3) {
      suspicious.push({
        code: 'ALL_MODIFIED_LOW_SIM',
        message: `All ${modifiedCount} edits are "modify" with avgSimilarity=${avgSim.toFixed(3)} — block matching may have failed`,
      });
    }
  }

  return { violations, suspicious };
}

/**
 * Validate computed stats against the edit array.
 * @param {Object} stats - Stats object from computeStatsFromEdits
 * @param {Array} edits - The edit array used to compute stats
 * @returns {{ violations: Array<{level:string, code:string, message:string}>, suspicious: Array<{code:string, message:string}> }}
 */
export function validateStats(stats, edits) {
  const violations = [];
  const suspicious = [];

  if (!stats || typeof stats !== 'object') {
    violations.push({ level: 'error', code: 'STATS_INVALID', message: 'stats is null or not an object' });
    return { violations, suspicious };
  }

  // INV-4: Count consistency
  const expectedTotal = (stats.added ?? 0) + (stats.deleted ?? 0) + (stats.modified ?? 0) + (stats.unchanged ?? 0);
  const actualTotal = Array.isArray(edits) ? edits.length : 0;
  if (expectedTotal !== actualTotal) {
    violations.push({
      level: 'error',
      code: 'COUNT_MISMATCH',
      message: `added(${stats.added})+deleted(${stats.deleted})+modified(${stats.modified})+unchanged(${stats.unchanged})=${expectedTotal} !== edits.length(${actualTotal})`,
    });
  }

  // INV-5: changeRatio is a valid number in [0, 1.0]
  if (typeof stats.changeRatio !== 'number' || Number.isNaN(stats.changeRatio) || !Number.isFinite(stats.changeRatio)) {
    violations.push({ level: 'error', code: 'RATIO_NAN', message: `changeRatio is ${stats.changeRatio}` });
  } else if (stats.changeRatio < 0 || stats.changeRatio > 1.0) {
    violations.push({ level: 'error', code: 'RATIO_OUT_OF_RANGE', message: `changeRatio=${stats.changeRatio} out of [0, 1.0]` });
  }

  // INV-6: oldTotal consistency
  const expectedOldTotal = (stats.deleted ?? 0) + (stats.unchanged ?? 0) + (stats.modified ?? 0);
  if (stats.oldTotal !== undefined && stats.oldTotal !== expectedOldTotal) {
    violations.push({
      level: 'warn',
      code: 'OLD_TOTAL_MISMATCH',
      message: `oldTotal(${stats.oldTotal}) !== del(${stats.deleted})+unchanged(${stats.unchanged})+modified(${stats.modified})=${expectedOldTotal}`,
    });
  }

  // ANOMALY-2: High changeRatio but no adds/deletes
  if (typeof stats.changeRatio === 'number' && stats.changeRatio > 0.8 && (stats.added ?? 0) === 0 && (stats.deleted ?? 0) === 0) {
    suspicious.push({
      code: 'HIGH_RATIO_NO_ADD_DEL',
      message: `changeRatio=${stats.changeRatio.toFixed(3)} > 0.8 but added=0 and deleted=0`,
    });
  }

  return { violations, suspicious };
}

/**
 * Merge two canary reports.
 */
export function mergeReports(a, b) {
  return {
    violations: [...(a.violations || []), ...(b.violations || [])],
    suspicious: [...(a.suspicious || []), ...(b.suspicious || [])],
  };
}
