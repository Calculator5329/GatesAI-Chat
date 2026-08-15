# Follow-up while streaming

*Design, 2026-07-26. Status: proposed, not implemented. Owner decision needed on
one fork (see "The fork").*

## What Ethan asked for

> "claude code handles follow ups and interruptions really well and we should
> apply it to gates ai chat. basically you can send at any time, the model like
> finishes its current thought, then interrupts itself, appends your message and
> resumes thinking and its smooth from the user side. like all I see is a text
> like 'read' once it reads the message. maybe double enter is force interrupt?"

Three live options are switchable in the design harness
(`gatesai-shell.html`, drawer → FOLLOW-UP). Play a stream, send a follow-up
part-way through, and compare.

## What ships today

Sending mid-stream is **already a hard interrupt**, and always has been.
`ChatTurnEngine.sendMessageToHydratedThread`
(`src/services/chat/chatTurnEngine.ts:90-93`):

```ts
const isReplacingInterruptedReply = this.isThreadStreaming(thread.id);
if (this.isThreadStreaming(thread.id)) {
  this.interruptThread(thread.id);
}
```

So the reply is aborted mid-token, the partial text stays in the transcript, and
the new turn starts from scratch. There is no queue, no acknowledgement, and no
resume. **This design changes a default; it does not add a capability from
nothing.** That matters for scoping: the interrupt path already works and is
already tested, and becomes the double-Enter escape hatch rather than something
new to build.

## Where a follow-up can safely land

`TurnRunner` runs one user turn as a bounded loop of provider rounds
(`src/services/chat/turnRunner.ts:231`):

```ts
for (let round = 0; round < maxToolRounds; round++) {
  if (signal.aborted) return;
  ...
  const outcome = await this.roundExecutor.execute({ ..., round, ... });
```

The gap between rounds is the natural delivery point, and it is the only one
that is actually safe:

- **Between rounds** the assistant message is coherent, tool results for the
  round are already appended, and nothing is half-written. A queued follow-up
  can be appended as a user message and the loop continued with the enlarged
  history.
- **Mid-round** is not safe. The provider stream is open, the assistant message
  is accumulating parts, and tool calls for that round may already be dispatched
  through `toolBatchExecutor`. Delivering here means either dropping tool
  results on the floor or reordering them relative to the user turn.
- **Mid-sentence** is not available at all. We do not parse the stream for
  sentence boundaries and should not start; "finishes its current thought" in
  the quote above maps to "finishes its current round", which is close enough in
  practice because rounds are short.

This gives a natural upper bound on latency: a queued follow-up waits at most
one round. A no-tool reply is a single round, so it waits for the reply to
finish, which is exactly the behaviour described.

## Proposed shape

**State.** A per-thread queue, owned by `ChatStore` because it must survive a
streaming turn and be visible to both the composer and the transcript. One
pending follow-up per thread is enough; a second send while one is queued
replaces it (with the chip showing the newer text) rather than growing a list
nobody asked for.

**Delivery.** `TurnRunner` checks the queue at the top of each round iteration,
next to the existing `if (signal.aborted) return;`. If a follow-up is waiting:
append it as a user message, mark it delivered, and continue the loop with the
enlarged history. The turn keeps its single assistant message per the file's
stated invariant, so the follow-up starts a *new* assistant message and the loop
must close the current one first.

**Acknowledgement.** The chip flips from `queued` to `read` at the moment of
delivery, then the message moves into the transcript. That is the "all I see is
a text like read" from the brief.

**Keyboard.** Enter queues. Enter twice within ~500ms force-interrupts, using
the existing `interruptThread` path unchanged. Escape while queued cancels the
pending follow-up rather than the turn.

**Persistence.** The queue is deliberately *not* persisted. A follow-up that was
never delivered when the app closed refers to a turn that no longer exists; on
next launch it would be delivered into a thread with no running turn, which is
just a normal send the user did not ask for. Drop it, and restore the text into
the composer draft instead, which already persists.

## The fork

Two of the three harness options are genuinely defensible and this is Ethan's
call:

- **Queue** shows the pending note as a chip above the composer and only moves
  it into the transcript on delivery. It can be cancelled, and the transcript
  never contains a message the model has not seen.
- **Post now** puts the message straight into the transcript and fades in a
  `read` mark when the model picks it up. Calmer, nothing hovers, but the
  transcript briefly contains a message that is not yet part of the
  conversation, and it cannot be taken back.

Recommendation: **Queue**, because the undo is worth more than the calm, and
because "not yet delivered" is a real state that the transcript has no way to
express honestly.

## What is hard

1. **The single-assistant-message invariant.** `turnRunner.ts:3` states "one
   user turn writes one assistant message, even across many tool rounds".
   Delivering a follow-up mid-turn breaks that by definition. Either the
   invariant gets an explicit exception, or delivery ends the current turn and
   starts a new one, which is simpler and probably right.
2. **Tool results in flight.** If the round that is finishing dispatched tool
   calls, their results must be appended before the follow-up, or the model sees
   a user turn interleaved into its own tool sequence.
3. **Abort semantics.** `interruptThread` currently means "the user replaced
   this reply". Force-interrupt keeps that meaning. The queued path must not go
   near it.
4. **Cost.** A delivered follow-up continues the same conversation, so the
   context grows and the next round costs more. Worth surfacing in the context
   meter rather than silently.

## Acceptance

- Sending mid-stream with the default setting does not abort the reply.
- The chip reads `queued`, then `read`, then the message appears in the
  transcript in that order.
- A queued follow-up is delivered within one round, and never between a tool
  call and its result.
- Double-Enter still aborts mid-token, exactly as today.
- Cancelling a queued follow-up leaves the turn untouched.
- Closing the app with a follow-up queued restores it to the composer draft and
  does not send it.
- Web Lite behaves identically: none of this needs the bridge.

## Not in scope

Editing a message that is already delivered, queueing more than one follow-up,
and steering an agent task from its origin thread. The last one is related but
belongs with the async-agent work in `docs/IDEAS.md`.
