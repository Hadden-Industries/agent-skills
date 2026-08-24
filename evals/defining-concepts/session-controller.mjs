function reject(message) {
  throw new Error(message);
}

function assertInitialInput(initialInput) {
  if (!Array.isArray(initialInput) || initialInput.length === 0) {
    reject("initialInput must be a nonempty array");
  }
  if (!Object.isFrozen(initialInput)) {
    reject("initialInput must be frozen");
  }
  for (const item of initialInput) {
    if (
      !Object.isFrozen(item) ||
      Object.keys(item).length !== 2 ||
      item.type !== "text" ||
      typeof item.text !== "string" ||
      item.text.length === 0
    ) {
      reject("initialInput items must be frozen nonempty text records");
    }
  }
}

export function createDefiningConceptController({ initialInput }) {
  assertInitialInput(initialInput);
  let completed = false;

  return Object.freeze({
    schemaVersion: 1,
    maxTurns: 1,
    initialInput,
    async onTurnCompleted(event) {
      if (
        completed ||
        event?.turnIndex !== 1 ||
        event?.status !== "completed" ||
        typeof event?.finalAnswer !== "string" ||
        event.finalAnswer.length === 0
      ) {
        reject("Defining-concepts requires one completed one-turn result");
      }
      completed = true;
      return Object.freeze({
        action: "complete",
        suiteResult: Object.freeze({ finalAnswer: event.finalAnswer }),
      });
    },
    async onApprovalRequest() {
      return Object.freeze({
        action: "reject",
        failureClass: "controller-failed",
        reason: "Defining-concepts sessions do not permit approval requests",
      });
    },
  });
}
