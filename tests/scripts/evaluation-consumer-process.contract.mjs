import assert from "node:assert/strict";
import {
  checkConsumerProcesses,
  PROCESS_SCENARIOS,
} from "../../scripts/evaluation/check-consumer-process.js";
const receipt = await checkConsumerProcesses();
assert.deepEqual(
  receipt.observations.map(({ scenario }) => scenario),
  PROCESS_SCENARIOS,
);
assert.equal(receipt.observations.length, 8);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
