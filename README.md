# messagepack-rpc

[![JSR](https://jsr.io/badges/@lambdalisue/messagepack-rpc)](https://jsr.io/@lambdalisue/messagepack-rpc)
[![Test](https://github.com/lambdalisue/deno-messagepack-rpc/workflows/Test/badge.svg)](https://github.com/lambdalisue/deno-messagepack-rpc/actions?query=workflow%3ATest)
[![codecov](https://codecov.io/github/lambdalisue/deno-messagepack-rpc/branch/main/graph/badge.svg?token=gXooPigw0y)](https://codecov.io/github/lambdalisue/deno-messagepack-rpc)

This is a TypeScript module that allows for the implementation of
[MessagePack-RPC] using [MessagePack] as the message schema.

[deno]: https://deno.land/
[MessagePack]: https://github.com/msgpack/msgpack/blob/master/spec.md
[MessagePack-RPC]: https://github.com/msgpack-rpc/msgpack-rpc

## Usage

### Server

```typescript
import { assert, is } from "@core/unknownutil";
import { Session } from "@lambdalisue/messagepack-rpc";

async function handleConnection(conn: Deno.Conn): Promise<void> {
  const session = new Session(conn.readable, conn.writable);

  // Define APIs
  session.dispatcher = {
    sum(x, y) {
      assert(x, is.Number);
      assert(y, is.Number);
      return x + y;
    },
  };

  // Start the session
  session.start();

  // Do whatever

  // Shutdown the session
  await session.shutdown();
}

const listener = Deno.listen({ hostname: "localhost", port: 8080 });
for await (const conn of listener) {
  handleConnection(conn).catch((err) => console.error(err));
}
```

### Client

```typescript
import { Client, Session } from "@lambdalisue/messagepack-rpc";

const conn = await Deno.connect({ hostname: "localhost", port: 8080 });
const session = new Session(conn.readable, conn.writable);
const client = new Client(session);

// Start the session
session.start();

// Do whatever
console.log(await client.call("sum", 1, 2)); // 3
console.log(await client.call("sum", 2, 3)); // 5

// Shutdown the session
await session.shutdown();
```

Although the original MessagePack-RPC specification does not mention
bidirectional communication, this module supports it. Therefore, APIs defined on
the client side can be called from the server side.

## License

The code is released under the MIT license, which is included in the
[LICENSE](./LICENSE) file. By contributing to this repository, contributors
agree to follow the license for any modifications made.
