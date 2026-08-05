export const OUTPUT_QUALITY_BASELINE_CHECKS = 28;

function failedChecks(report) {
  return (report.sources ?? []).flatMap((source) =>
    (source.checks ?? [])
      .filter((check) => !check.passed)
      .map((check) => ({
        source_id: source.source_id,
        name: check.name,
        category: check.category ?? "unknown",
        detail: check.detail ?? "No detail provided",
      }))
  );
}

export function evaluateOutputQualityGate(report) {
  const failures = failedChecks(report);
  const retentionFailures = failures.filter((failure) => failure.category === "retention");
  const errors = [];

  if ((report.summary?.total ?? 0) < OUTPUT_QUALITY_BASELINE_CHECKS) {
    errors.push(
      `Eval contains ${report.summary?.total ?? 0} checks; ` +
        `the protected baseline contains ${OUTPUT_QUALITY_BASELINE_CHECKS}.`
    );
  }

  if ((report.summary?.passed ?? 0) < OUTPUT_QUALITY_BASELINE_CHECKS) {
    errors.push(
      `Only ${report.summary?.passed ?? 0}/${OUTPUT_QUALITY_BASELINE_CHECKS} baseline checks passed.`
    );
  }

  if ((report.summary?.failed ?? failures.length) > 0 || failures.length > 0) {
    errors.push(`${Math.max(report.summary?.failed ?? 0, failures.length)} eval check(s) failed.`);
  }

  if (retentionFailures.length > 0) {
    errors.push(`${retentionFailures.length} distinct-signal retention check(s) failed.`);
  }

  return {
    passed: errors.length === 0,
    errors,
    failures,
    retention_failures: retentionFailures,
  };
}

export function printOutputQualityGate(result, logger = console) {
  if (result.passed) {
    logger.log(
      `Output quality gate passed at or above ` +
        `${OUTPUT_QUALITY_BASELINE_CHECKS}/${OUTPUT_QUALITY_BASELINE_CHECKS}.`
    );
    return;
  }

  logger.error("Output quality gate failed:");
  for (const error of result.errors) logger.error(`- ${error}`);

  const categories = result.failures.reduce((counts, failure) => {
    counts[failure.category] = (counts[failure.category] ?? 0) + 1;
    return counts;
  }, {});
  if (Object.keys(categories).length > 0) {
    logger.error(`Failure categories: ${JSON.stringify(categories)}`);
  }

  for (const failure of result.failures) {
    logger.error(
      `- [${failure.category}] ${failure.source_id}/${failure.name}: ${failure.detail}`
    );
  }
}
