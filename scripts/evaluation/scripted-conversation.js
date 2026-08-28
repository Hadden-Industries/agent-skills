const FOLLOW_UP_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function textInput(text) {
  return Object.freeze({ type: "text", text });
}

function freezeDeep(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      freezeDeep(child);
    }
  }
  return value;
}

function assertNormalizedConversation(conversation) {
  if (
    !Array.isArray(conversation) ||
    conversation.length === 0 ||
    conversation.length > 32 ||
    !Object.isFrozen(conversation)
  ) {
    fail("conversation must be a frozen array containing 1 to 32 turns");
  }

  const ids = new Set();
  for (const [index, turn] of conversation.entries()) {
    if (
      turn === null ||
      typeof turn !== "object" ||
      Array.isArray(turn) ||
      !Object.isFrozen(turn) ||
      Object.keys(turn).sort().join(",") !== "id,input" ||
      !isNonemptyString(turn.id) ||
      turn.input === null ||
      typeof turn.input !== "object" ||
      Array.isArray(turn.input) ||
      !Object.isFrozen(turn.input) ||
      Object.keys(turn.input).sort().join(",") !== "text,type" ||
      turn.input.type !== "text" ||
      !isNonemptyString(turn.input.text)
    ) {
      fail(`conversation turn ${index + 1} is malformed`);
    }
    if (ids.has(turn.id)) {
      fail(`conversation contains duplicate id ${JSON.stringify(turn.id)}`);
    }
    ids.add(turn.id);
  }

  if (conversation[0].id !== "prompt") {
    fail("conversation first turn must use id prompt");
  }
}

export function normalizeEvaluationConversation(evaluationCase) {
  if (
    evaluationCase === null ||
    typeof evaluationCase !== "object" ||
    Array.isArray(evaluationCase) ||
    !isNonemptyString(evaluationCase.prompt)
  ) {
    fail("evaluation prompt must be a nonempty string");
  }

  const turns = [
    Object.freeze({ id: "prompt", input: textInput(evaluationCase.prompt) }),
  ];

  if (Object.hasOwn(evaluationCase, "follow_up_turns")) {
    const followUps = evaluationCase.follow_up_turns;
    if (!Array.isArray(followUps) || followUps.length === 0) {
      fail("follow_up_turns must be a nonempty array when present");
    }
    if (followUps.length > 31) {
      fail("follow_up_turns must contain at most 31 entries");
    }

    const ids = new Set(["prompt"]);
    for (const [index, followUp] of followUps.entries()) {
      if (
        followUp === null ||
        typeof followUp !== "object" ||
        Array.isArray(followUp) ||
        Object.keys(followUp).sort().join(",") !== "id,prompt"
      ) {
        fail(`follow-up at index ${index} must contain exactly id and prompt`);
      }
      if (
        typeof followUp.id !== "string" ||
        !FOLLOW_UP_ID_PATTERN.test(followUp.id)
      ) {
        fail(`follow-up at index ${index} has an invalid id`);
      }
      if (ids.has(followUp.id)) {
        fail(`conversation contains duplicate follow-up id ${JSON.stringify(followUp.id)}`);
      }
      if (!isNonemptyString(followUp.prompt)) {
        fail(`follow-up ${JSON.stringify(followUp.id)} has an empty prompt`);
      }
      ids.add(followUp.id);
      turns.push(
        Object.freeze({
          id: followUp.id,
          input: textInput(followUp.prompt),
        }),
      );
    }
  }

  return Object.freeze(turns);
}

export function createScriptedConversationController({
  conversation,
  completeResult,
}) {
  assertNormalizedConversation(conversation);
  if (typeof completeResult !== "function") {
    fail("completeResult must be a function");
  }

  let expectedTurnIndex = 1;
  let completed = false;
  const initialInput = Object.freeze([conversation[0].input]);

  return Object.freeze({
    schemaVersion: 1,
    maxTurns: conversation.length,
    initialInput,
    async onTurnCompleted(event) {
      if (completed) {
        fail("scripted conversation is already completed");
      }
      if (
        event?.turnIndex !== expectedTurnIndex ||
        event?.status !== "completed" ||
        !isNonemptyString(event?.finalAnswer)
      ) {
        fail(`scripted conversation expected completed turn ${expectedTurnIndex}`);
      }

      if (expectedTurnIndex < conversation.length) {
        const nextTurn = conversation[expectedTurnIndex];
        expectedTurnIndex += 1;
        return Object.freeze({
          action: "continue",
          transitionId: nextTurn.id,
          input: Object.freeze([nextTurn.input]),
        });
      }

      const suiteResult = completeResult(event);
      if (
        suiteResult === null ||
        typeof suiteResult !== "object" ||
        Array.isArray(suiteResult)
      ) {
        fail("completeResult must return an object");
      }
      completed = true;
      return Object.freeze({
        action: "complete",
        suiteResult: freezeDeep(suiteResult),
      });
    },
    async onApprovalRequest() {
      return Object.freeze({
        action: "reject",
        failureClass: "controller-failed",
        reason: "Scripted evaluation sessions do not permit approval requests",
      });
    },
  });
}

export function createScriptedContinuationPolicy({
  conversation,
  controllerSha256,
}) {
  assertNormalizedConversation(conversation);
  if (
    typeof controllerSha256 !== "string" ||
    !SHA256_PATTERN.test(controllerSha256)
  ) {
    fail("controllerSha256 must be a lowercase SHA-256 digest");
  }

  const followUps = conversation.slice(1);
  const allowedTransitions = Object.freeze(followUps.map(({ id }) => id));
  const templates = Object.freeze(
    followUps.map(({ id, input }) =>
      Object.freeze({
        transitionId: id,
        input: Object.freeze([input]),
      }),
    ),
  );

  return Object.freeze({
    controllerSha256,
    maxTurns: conversation.length,
    allowedTransitions,
    templates,
  });
}
