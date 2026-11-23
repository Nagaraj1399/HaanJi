import {
  runCausalLoopProof,
  runGoldenSetEvaluation,
  runTrackAUnitTests,
  runTrackBUnitTests,
} from "./tests/runner.ts";

async function main() {
  const mode = process.argv.includes("--live") ? "live" : "replay";
  console.log(`\n=== HaanJi Verification Suite (mode=${mode}) ===\n`);

  const aUnits = await runTrackAUnitTests();
  for (const r of aUnits) {
    console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.id} ${r.name} (${r.duration_ms}ms) -> ${r.details}`);
  }

  const bUnits = await runTrackBUnitTests();
  for (const r of bUnits) {
    console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.id} ${r.name} (${r.duration_ms}ms) -> ${r.details}`);
  }

  const golden = await runGoldenSetEvaluation(mode);
  console.log(`\nGolden Set (${golden.total} cases, mode=${golden.mode}):`, golden.metrics);

  const loop = await runCausalLoopProof();
  console.log(`\nCausal Loop Proof: passed=${loop.passed}, safety_invariant=${loop.safety_invariant_held}, 429_reduction=${loop.comparison_429.reduction_pct}%`);
  for (const n of loop.negative_tests) {
    console.log(`[${n.passed ? "PASS" : "FAIL"}] ${n.id} ${n.name} -> ${n.details}`);
  }

  const allPassed =
    aUnits.every((x) => x.passed) &&
    bUnits.every((x) => x.passed) &&
    golden.metrics.all_gates_pass &&
    loop.passed;

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
