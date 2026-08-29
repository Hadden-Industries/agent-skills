import assert from "node:assert/strict";
import test from "node:test";

import {
  createScriptedContinuationPolicy,
  createScriptedConversationController,
  normalizeEvaluationConversation,
} from "../../scripts/evaluation/scripted-conversation.js";

const MULTI_TURN_CASE = Object.freeze({
  prompt: "Define charge for this model.",
  follow_up_turns: Object.freeze([
    Object.freeze({
      id: "select-electric-charge",
      prompt: "Use electric charge as the physical quantity.",
    }),
    Object.freeze({
      id: "request-concept-package",
      prompt: "Now provide the full concept package.",
    }),
  ]),
});

function completedEvent(turnIndex, finalAnswer = `answer-${turnIndex}`) {
  return Object.freeze({
    turnIndex,
    status: "completed",
    finalAnswer,
  });
}

test("normalization preserves one-turn behavior and freezes exact input bytes", () => {
  const conversation = normalizeEvaluationConversation({
    prompt: "Define dataset.",
  });

  assert.deepEqual(conversation, [
    {
      id: "prompt",
      input: { type: "text", text: "Define dataset." },
    },
  ]);
  assert.ok(Object.isFrozen(conversation));
  assert.ok(Object.isFrozen(conversation[0]));
  assert.ok(Object.isFrozen(conversation[0].input));
});

test("normalization preserves declarative follow-up order", () => {
  const conversation = normalizeEvaluationConversation(MULTI_TURN_CASE);

  assert.deepEqual(
    conversation.map(({ id, input }) => ({ id, text: input.text })),
    [
      { id: "prompt", text: "Define charge for this model." },
      {
        id: "select-electric-charge",
        text: "Use electric charge as the physical quantity.",
      },
      {
        id: "request-concept-package",
        text: "Now provide the full concept package.",
      },
    ],
  );
});

test("one-turn controller treats the completed final answer as authoritative", async () => {
  const conversation = normalizeEvaluationConversation({
    prompt: "Define dataset.",
  });
  const controller = createScriptedConversationController({
    conversation,
    completeResult: ({ finalAnswer }) => ({ finalAnswer }),
  });

  assert.equal(controller.maxTurns, 1);
  assert.deepEqual(controller.initialInput, [
    { type: "text", text: "Define dataset." },
  ]);
  assert.deepEqual(await controller.onTurnCompleted(completedEvent(1)), {
    action: "complete",
    suiteResult: { finalAnswer: "answer-1" },
  });
});

test("three-turn controller emits each exact continuation before completing", async () => {
  const conversation = normalizeEvaluationConversation(MULTI_TURN_CASE);
  const controller = createScriptedConversationController({
    conversation,
    completeResult: ({ finalAnswer }) => ({ finalAnswer }),
  });

  assert.equal(controller.maxTurns, 3);
  assert.deepEqual(await controller.onTurnCompleted(completedEvent(1)), {
    action: "continue",
    transitionId: "select-electric-charge",
    input: [
      { type: "text", text: "Use electric charge as the physical quantity." },
    ],
  });
  assert.deepEqual(await controller.onTurnCompleted(completedEvent(2)), {
    action: "continue",
    transitionId: "request-concept-package",
    input: [{ type: "text", text: "Now provide the full concept package." }],
  });
  assert.deepEqual(
    await controller.onTurnCompleted(completedEvent(3, "final package")),
    {
      action: "complete",
      suiteResult: { finalAnswer: "final package" },
    },
  );
});

test("controller rejects repeated, out-of-order, malformed, and post-completion events", async () => {
  const createController = () =>
    createScriptedConversationController({
      conversation: normalizeEvaluationConversation(MULTI_TURN_CASE),
      completeResult: ({ finalAnswer }) => ({ finalAnswer }),
    });

  await assert.rejects(
    createController().onTurnCompleted(completedEvent(2)),
    /expected completed turn 1/u,
  );
  await assert.rejects(
    createController().onTurnCompleted({
      turnIndex: 1,
      status: "failed",
      finalAnswer: "ignored",
    }),
    /expected completed turn 1/u,
  );

  const repeated = createController();
  await repeated.onTurnCompleted(completedEvent(1));
  await assert.rejects(
    repeated.onTurnCompleted(completedEvent(1)),
    /expected completed turn 2/u,
  );

  const completed = createController();
  await completed.onTurnCompleted(completedEvent(1));
  await completed.onTurnCompleted(completedEvent(2));
  await completed.onTurnCompleted(completedEvent(3));
  await assert.rejects(
    completed.onTurnCompleted(completedEvent(3)),
    /already completed/u,
  );
});

test("continuation policy binds every follow-up exactly once", () => {
  const conversation = normalizeEvaluationConversation(MULTI_TURN_CASE);
  const policy = createScriptedContinuationPolicy({
    conversation,
    controllerSha256: "5".repeat(64),
  });

  assert.deepEqual(policy, {
    controllerSha256: "5".repeat(64),
    maxTurns: 3,
    allowedTransitions: ["select-electric-charge", "request-concept-package"],
    templates: [
      {
        transitionId: "select-electric-charge",
        input: [
          {
            type: "text",
            text: "Use electric charge as the physical quantity.",
          },
        ],
      },
      {
        transitionId: "request-concept-package",
        input: [
          { type: "text", text: "Now provide the full concept package." },
        ],
      },
    ],
  });
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.allowedTransitions));
  assert.ok(Object.isFrozen(policy.templates));
  assert.ok(policy.templates.every((template) => Object.isFrozen(template)));
});

test("one-turn continuation policy has no templates or transitions", () => {
  const policy = createScriptedContinuationPolicy({
    conversation: normalizeEvaluationConversation({
      prompt: "Define dataset.",
    }),
    controllerSha256: "6".repeat(64),
  });

  assert.equal(policy.maxTurns, 1);
  assert.deepEqual(policy.allowedTransitions, []);
  assert.deepEqual(policy.templates, []);
});

test("approval requests are rejected without domain-specific behavior", async () => {
  const controller = createScriptedConversationController({
    conversation: normalizeEvaluationConversation({
      prompt: "Define dataset.",
    }),
    completeResult: ({ finalAnswer }) => ({ finalAnswer }),
  });

  assert.deepEqual(await controller.onApprovalRequest(), {
    action: "reject",
    failureClass: "controller-failed",
    reason: "Scripted evaluation sessions do not permit approval requests",
  });
});

test("normalization rejects malformed conversation declarations", () => {
  assert.throws(
    () => normalizeEvaluationConversation({ prompt: " " }),
    /prompt must be a nonempty string/u,
  );
  assert.throws(
    () =>
      normalizeEvaluationConversation({
        prompt: "Define dataset.",
        follow_up_turns: [],
      }),
    /follow_up_turns must be a nonempty array/u,
  );
  assert.throws(
    () =>
      normalizeEvaluationConversation({
        prompt: "Define dataset.",
        follow_up_turns: [
          { id: "duplicate", prompt: "First." },
          { id: "duplicate", prompt: "Second." },
        ],
      }),
    /duplicate follow-up id/u,
  );
});
