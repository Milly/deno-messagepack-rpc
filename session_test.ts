import {
  assert,
  assertEquals,
  AssertionError,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { deadline, DeadlineError } from "@std/async";
import { decode, encode } from "@lambdalisue/messagepack";
import {
  type Channel,
  channel,
  collect,
  pop,
  push,
} from "@lambdalisue/streamtools";
import {
  buildNotificationMessage,
  buildRequestMessage,
  buildResponseMessage,
} from "./message.ts";
import { Session } from "./session.ts";

function createDummySession(): {
  input: Channel<Uint8Array>;
  output: Channel<Uint8Array>;
  session: Session;
} {
  const input = channel<Uint8Array>();
  const output = channel<Uint8Array>();
  const session = new Session(input.reader, output.writer);
  return { input, output, session };
}

function ensureNotNull<T>(value: T | null): T {
  if (value === null) {
    throw new AssertionError("value must not be null");
  }
  return value;
}

Deno.test("Session.send", async (t) => {
  await t.step(
    "throws an error if the session is not started",
    () => {
      const { session } = createDummySession();

      const message = buildRequestMessage(1, "sum", [1, 2]);
      assertThrows(
        () => session.send(message),
        Error,
        "Session is not running",
      );
    },
  );

  await t.step(
    "sends a message to the specified writer",
    async () => {
      const { session, output } = createDummySession();

      session.start();

      const message = buildRequestMessage(1, "sum", [1, 2]);
      session.send(message);
      assertEquals(
        decode(ensureNotNull(await pop(output.reader))),
        message,
      );
    },
  );
});

Deno.test("Session.recv", async (t) => {
  await t.step(
    "throws an error if the session is not started",
    () => {
      const { session } = createDummySession();

      assertThrows(() => session.recv(1), Error, "Session is not running");
    },
  );

  await t.step(
    "waits a corresponding response message and resolves with it",
    async () => {
      const { session, input } = createDummySession();

      session.start();

      const message = buildResponseMessage(1, null, 3);
      push(input.writer, encode(message));
      assertEquals(
        await session.recv(1),
        message,
      );
    },
  );
});

Deno.test("Session.start", async (t) => {
  await t.step(
    "throws an error if the session is already started",
    () => {
      const { session } = createDummySession();

      session.start();
      assertThrows(() => session.start(), Error, "Session is already running");
    },
  );

  await t.step(
    "locks specified reader and writer",
    () => {
      const { session, input, output } = createDummySession();

      session.start();
      assert(input.reader.locked, "reader is not locked");
      assert(output.writer.locked, "writer is not locked");
    },
  );

  await t.step(
    "invokes a method defined in `dispatcher` and send-back a response message when a request message is received",
    async () => {
      let called = false;
      const { session, input, output } = createDummySession();
      session.dispatcher = {
        sum: (a, b) => {
          called = true;
          assertEquals(a, 1);
          assertEquals(b, 2);
          return 3;
        },
      };
      session.start();

      await push(input.writer, encode(buildRequestMessage(1, "sum", [1, 2])));
      await session.shutdown();
      assert(called, "handler is not called");
      assertEquals(await collect(output.reader), [
        encode(buildResponseMessage(1, null, 3)),
      ]);
    },
  );

  await t.step(
    "invokes a method defined in `dispatcher` and send-back a response message when a request message is received (error)",
    async () => {
      let called = false;
      const { session, input, output } = createDummySession();
      session.dispatcher = {
        sum: () => {
          called = true;
          throw "sum error";
        },
      };
      session.start();

      await push(input.writer, encode(buildRequestMessage(1, "sum", [1, 2])));
      await session.shutdown();
      assert(called, "handler is not called");
      assertEquals(await collect(output.reader), [
        encode(
          buildResponseMessage(1, "sum error", null),
        ),
      ]);
    },
  );

  await t.step(
    "invokes a method defined in `dispatcher` when a notification message is received",
    async () => {
      let called = false;
      const { session, input, output } = createDummySession();
      session.dispatcher = {
        sum: (a, b) => {
          called = true;
          assertEquals(a, 1);
          assertEquals(b, 2);
          return 3;
        },
      };
      session.start();

      await push(input.writer, encode(buildNotificationMessage("sum", [1, 2])));
      await session.shutdown();
      assert(called, "handler is not called");
      assertEquals(await collect(output.reader), []);
    },
  );

  await t.step(
    "invokes a method defined in `dispatcher` when a notification message is received (error)",
    async () => {
      let called = false;
      const { session, input, output } = createDummySession();
      session.dispatcher = {
        sum: () => {
          called = true;
          throw "sum error";
        },
      };
      session.start();

      await push(input.writer, encode(buildNotificationMessage("sum", [1, 2])));
      await session.shutdown();
      assert(called, "handler is not called");
      assertEquals(await collect(output.reader), []);
    },
  );
});

Deno.test("Session.wait", async (t) => {
  await t.step(
    "throws an error if the session is not started",
    () => {
      const { session } = createDummySession();

      assertThrows(() => session.wait(), Error, "Session is not running");
    },
  );

  await t.step(
    "returns a promise that is resolved when the session is closed (reader is closed)",
    async () => {
      const output = channel<Uint8Array>();
      const { promise, resolve } = Promise.withResolvers<void>();
      const session = new Session(
        // Reader that is not closed until the guard is resolved
        new ReadableStream({
          async start(controller) {
            await promise;
            controller.close();
          },
        }),
        output.writer,
      );

      session.start();

      const waiter = session.wait();
      await assertRejects(
        () => deadline(waiter, 100),
        DeadlineError,
      );
      resolve();
      await deadline(waiter, 100);
    },
  );
});

Deno.test("Session.shutdown", async (t) => {
  await t.step(
    "throws an error if the session is not started",
    () => {
      const { session } = createDummySession();

      assertThrows(() => session.shutdown(), Error, "Session is not running");
    },
  );

  await t.step(
    "unlocks specified reader and writer",
    async () => {
      const { session, input, output } = createDummySession();

      session.start();
      await session.shutdown();
      assert(!input.reader.locked, "reader is locked");
      assert(!output.writer.locked, "writer is locked");
    },
  );

  await t.step(
    "waits until all messages are processed to the writer",
    async () => {
      const input = channel<Uint8Array>();
      const { promise, resolve } = Promise.withResolvers<void>();
      const session = new Session(
        input.reader,
        // Writer that is not processed until the guard is resolved
        new WritableStream({
          async write() {
            await promise;
          },
        }),
      );

      session.start();
      session.send(buildRequestMessage(1, "sum", [1, 2]));
      const shutdown = session.shutdown();
      await assertRejects(
        () => deadline(shutdown, 100),
        DeadlineError,
      );
      // Process all messages
      resolve();
      await deadline(shutdown, 100);
    },
  );
});

Deno.test("Session.forceShutdown", async (t) => {
  await t.step(
    "throws an error if the session is not started",
    () => {
      const { session } = createDummySession();

      assertThrows(
        () => session.forceShutdown(),
        Error,
        "Session is not running",
      );
    },
  );

  await t.step(
    "unlocks specified reader and writer",
    async () => {
      const { session, input, output } = createDummySession();

      session.start();
      await session.forceShutdown();
      assert(!input.reader.locked, "reader is locked");
      assert(!output.writer.locked, "writer is locked");
    },
  );

  await t.step(
    "does not wait until all messages are processed to the writer",
    async () => {
      const input = channel<Uint8Array>();
      const { promise, resolve } = Promise.withResolvers<void>();
      const session = new Session(
        input.reader,
        // Writer that is not processed until the guard is resolved
        new WritableStream({
          async write() {
            await promise;
          },
        }),
      );

      session.start();
      session.send(buildRequestMessage(1, "sum", [1, 2]));
      const shutdown = session.forceShutdown();
      await deadline(shutdown, 100);
      resolve();
    },
  );
});

Deno.test("Session.onInvalidMessage", async (t) => {
  await t.step(
    "is called when an invalid message is received",
    async () => {
      let called = false;
      const { session, input } = createDummySession();
      session.onInvalidMessage = (message) => {
        called = true;
        assertEquals(message, "invalid");
      };
      session.start();

      await push(input.writer, encode("invalid"));
      await session.shutdown();
      assert(called, "onInvalidMessage is not called");
    },
  );

  await t.step(
    "is called when an invalid message is received (array)",
    async () => {
      let called = false;
      const { session, input } = createDummySession();
      session.onInvalidMessage = (message) => {
        called = true;
        assertEquals(message, [3, "invalid"]);
      };
      session.start();

      await push(input.writer, encode([3, "invalid"]));
      await session.shutdown();
      assert(called, "onInvalidMessage is not called");
    },
  );
});

Deno.test("Session.onMessageError", async (t) => {
  await t.step(
    "is called when handling a request message fails (sending a response fails)",
    async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      let called: unknown;
      const { session, input } = createDummySession();
      session.dispatcher = {
        sum() {
          return 3;
        },
      };
      session.onMessageError = (error, message) => {
        called = [error.message, message];
        resolve();
      };
      session.start();

      // deno-lint-ignore no-explicit-any
      (session as any).send = () => {
        throw new Error("send error");
      };

      await push(input.writer, encode(buildRequestMessage(1, "sum", [1, 2])));
      await session.shutdown();
      await promise;
      assertEquals(called, [
        "send error",
        buildRequestMessage(1, "sum", [1, 2]),
      ]);
    },
  );

  await t.step(
    "is called when handling a response message fails (unexpected response message is received)",
    async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      let called: unknown;
      const { session, input } = createDummySession();
      session.dispatcher = {
        sum() {
          return 3;
        },
      };
      session.onMessageError = (error, message) => {
        called = [error.message, message];
        resolve();
      };
      session.start();

      await push(input.writer, encode(buildResponseMessage(1, null, 3)));
      await session.shutdown();
      await promise;
      assertEquals(called, [
        "Reservation with key 1 does not exist",
        buildResponseMessage(1, null, 3),
      ]);
    },
  );

  await t.step(
    "is called when handling a notification message fails (dispatch fails)",
    async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      let called: unknown;
      const { session, input } = createDummySession();
      session.dispatcher = {
        sum() {
          throw new Error("sum error");
        },
      };
      session.onMessageError = (error, message) => {
        called = [error.message, message];
        resolve();
      };
      session.start();

      await push(input.writer, encode(buildNotificationMessage("sum", [1, 2])));
      await session.shutdown();
      await promise;
      assertEquals(called, [
        "sum error",
        buildNotificationMessage("sum", [1, 2]),
      ]);
    },
  );
});
