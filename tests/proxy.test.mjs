import assert from "node:assert/strict";
import test from "node:test";
import {
  chatToResponsesSse,
  responsesToChat
} from "../deepseek_responses_proxy.mjs";

test("converts Codex Responses input to DeepSeek Chat JSON mode", () => {
  const result = responsesToChat(
    {
      model: "deepseek-v4-pro",
      instructions: "Return JSON.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Plan tomorrow." }]
        }
      ],
      reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", name: "planner" } }
    },
    { model: "deepseek-v4-pro", reasoningEffort: "high" },
  );

  assert.equal(result.model, "deepseek-v4-pro");
  assert.deepEqual(result.response_format, { type: "json_object" });
  assert.equal(result.reasoning_effort, "high");
  assert.deepEqual(result.thinking, { type: "enabled" });
  assert.equal(result.messages[0].role, "system");
  assert.equal(result.messages[1].content, "Plan tomorrow.");
  assert.equal(result.stream, false);
});

test("converts DeepSeek usage and text to Responses SSE", () => {
  const sse = chatToResponsesSse({
    id: "chatcmpl_1",
    created: 123,
    model: "deepseek-v4-pro",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: '{"reply":"ok"}' }
      }
    ],
    usage: {
      prompt_tokens: 20,
      prompt_cache_hit_tokens: 15,
      completion_tokens: 5,
      total_tokens: 25,
      completion_tokens_details: { reasoning_tokens: 2 }
    }
  });

  assert.match(sse, /event: response\.output_text\.delta/);
  assert.match(sse, /\\"reply\\":\\"ok\\"/);
  assert.match(sse, /event: response\.completed/);
  assert.match(sse, /"cached_tokens":15/);
  assert.match(sse, /"reasoning_tokens":2/);
});

test("does not forward Responses tools to the planner model", () => {
  const result = responsesToChat({
    input: [{ role: "user", content: "Do not use tools." }],
    tools: [{ type: "function", name: "shell" }]
  });

  assert.equal("tools" in result, false);
  assert.equal("tool_choice" in result, false);
});
