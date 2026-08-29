import { createScriptedConversationController } from "../../scripts/evaluation/scripted-conversation.js";

export function createDefiningConceptController({ conversation }) {
  const shared = createScriptedConversationController({
    conversation,
    completeResult(event) {
      return Object.freeze({ finalAnswer: event.finalAnswer });
    },
  });

  return Object.freeze({
    schemaVersion: shared.schemaVersion,
    maxTurns: shared.maxTurns,
    initialInput: shared.initialInput,
    onTurnCompleted: shared.onTurnCompleted,
    async onApprovalRequest() {
      return Object.freeze({
        action: "reject",
        failureClass: "controller-failed",
        reason: "Defining-concepts sessions do not permit approval requests",
      });
    },
  });
}
