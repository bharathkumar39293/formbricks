import { beforeEach, describe, expect, test, vi } from "vitest";
import { Config } from "@/lib/common/config";
import { sendUpdates } from "@/lib/user/update";
import { UpdateQueue } from "@/lib/user/update-queue";

// Mock dependencies
vi.mock("@/lib/common/config", () => ({
  Config: {
    getInstance: vi.fn(() => ({
      get: vi.fn(() => ({
        user: {
          data: {
            userId: "mock-user-id",
          },
        },
      })),
    })),
  },
}));

vi.mock("@/lib/user/update", () => ({
  sendUpdates: vi.fn(),
}));

describe("UpdateQueue Concurrency (Bug Reproduction)", () => {
  let updateQueue: UpdateQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance
    (UpdateQueue as unknown as { instance: null }).instance = null;
    updateQueue = UpdateQueue.getInstance();
  });

  test("deterministic data loss: attributes added during sendUpdates are wiped", async () => {
    let resolveSend: (value: any) => void;
    const sendPromise = new Promise((resolve) => {
      resolveSend = resolve;
    });

    // 1. Mock sendUpdates to hang until we manually resolve it
    (sendUpdates as any).mockReturnValue(sendPromise);

    // 2. Initial attribute sets triggering a flush
    updateQueue.updateAttributes({ foo: "bar" });
    const flushPromise = updateQueue.processUpdates();

    // 3. Advance past debounce (500ms) so sendUpdates is called
    // Since we aren't using fake timers here for simplicity in async flow,
    // we just wait a bit longer than the debounce.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(sendUpdates).toHaveBeenCalledTimes(1);
    expect(sendUpdates).toHaveBeenCalledWith({
      updates: {
        userId: "mock-user-id",
        attributes: { foo: "bar" },
      },
    });

    // Confirm state before concurrent updates arrive
    expect(updateQueue.getUpdates()?.attributes).toEqual({ foo: "bar" });

    // 4. WHILE the request is "in flight", add new attributes
    updateQueue.updateAttributes({ biz: "baz" });

    // Also change an existing attribute to test the "value changed" scenario
    updateQueue.updateAttributes({ foo: "new-bar" });

    // 5. Resolve the network request
    resolveSend!({
      ok: true,
      data: { hasWarnings: false },
    });

    // 6. Wait for the flush to complete
    await flushPromise;

    // 7. ASSERTION: The queue should NOT be empty.
    // It should contain the updates that arrived during the flight.
    const remainingUpdates = updateQueue.getUpdates();

    expect(remainingUpdates).not.toBeNull();
    expect(remainingUpdates?.attributes).toEqual({
      biz: "baz",
      foo: "new-bar",
    });
  });

  test("preserves userId update during in-flight flush without attributes", async () => {
    let resolveRequest: (value: any) => void;
    const sendPromise = new Promise((resolve) => {
      resolveRequest = resolve;
    });

    (sendUpdates as any).mockReturnValue(sendPromise);

    // 1. Start flush with userId = "A"
    updateQueue.updateUserId("A");
    const flushPromise = updateQueue.processUpdates();

    // 2. Advance past debounce so sendUpdates is called
    await new Promise((resolve) => setTimeout(resolve, 600));

    // 3. Change userId to "B" during in-flight request — no new attributes
    updateQueue.updateUserId("B");

    // 4. Resolve the network request
    resolveRequest!({ ok: true, data: { hasWarnings: false } });
    await flushPromise;

    // 5. ASSERTION: "B" must not be lost to cleanup
    // If this.updates were wiped unconditionally, userId "B" would be permanently lost.
    expect(updateQueue.getUpdates()?.userId).toBe("B");
  });
});
