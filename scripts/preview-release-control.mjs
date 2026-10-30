/** Code rollback must not cross a schema or storage-binding rollout. */
export function assertCompatibleSchema(changedMigrations, previous, next) {
  if (
    changedMigrations ||
    ["migrations", "d1_databases", "durable_objects", "r2_buckets", "version_metadata", "vars", "routes"].some(
      (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
    )
  )
    throw new Error(
      "Schema or storage binding changes require a separate compatible rollout before automatic code rollback is safe",
    );
}

/** Roll back only the candidate whose checks this invocation owns. */
export async function release({ deploy, version, smoke, rollback }, receipt) {
  receipt.previous = await version();
  try {
    receipt.candidate = await deploy(receipt.previous);
    if (!receipt.candidate || (await version()) !== receipt.candidate)
      throw new Error("Published candidate is not the active version");
    receipt.checks = await smoke(receipt.candidate);
    receipt.pass = true;
  } catch (error) {
    receipt.error = error.message;
    try {
      const active = await version();
      if (receipt.candidate && active === receipt.candidate && active !== receipt.previous) {
        await rollback(receipt.previous);
        await smoke(receipt.previous);
        receipt.rollback = receipt.previous;
      }
    } catch (recoveryError) {
      receipt.recoveryError = recoveryError.message;
    }
    throw error;
  }
}
