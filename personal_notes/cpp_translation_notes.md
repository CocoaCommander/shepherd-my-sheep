# C++ (oatpp) ↔ Express/Node Translation Notes

## Concept Mapping

| Express / Node concept | oatpp / C++ equivalent |
|---|---|
| `express()` | `AppComponent` — a DI container that creates your shared objects (router, JSON serializer, DB pool). Think of it as your `app.ts` setup file. |
| `app.use(express.json())` | `ObjectMapper` — oatpp's built-in JSON serializer/deserializer. Created once in AppComponent. |
| `express.Router()` | `HttpRouter` — same idea, maps HTTP methods + paths to handler functions. |
| `app.post('/graphql', handler)` | A `Controller` class with annotated methods — you define `ENDPOINT("POST", "/graphql", handleGraphQL, ...)`. Each controller is like a route file. |
| `app.listen(8080)` | `ConnectionProvider` + `Server` — the provider binds the port, the server accepts connections. Two objects instead of one call. |
| `req.body` | oatpp DTOs — C++ structs with macros that auto-serialize from/to JSON. Like Zod schemas but at compile time. |
| `pg` / `knex` pool | `DatabasePool` wrapping `libpqxx` — a pool of Postgres connections, same concept as `pg.Pool`. |
| `process.env.PORT` | `std::getenv("API_PORT")` — same idea, reads from environment. |
| `middleware` | oatpp `RequestInterceptor` — runs before the handler, same as Express middleware. Auth would live here. |
| `process.env.X ?? 'default'` | `getEnvOr("X", "default")` helper using `std::getenv()` — returns the env var or a fallback. |

## main.cpp Flow

```
Express:                              C++ (oatpp):
─────────                             ──────────────
const app = express()          →      AppComponent components
                                      (creates router, JSON mapper, DB pool)

app.use(json())                →      ObjectMapper created in AppComponent

app.use('/graphql', router)    →      GraphQLController registered on HttpRouter

app.listen(PORT, HOST, cb)     →      ConnectionProvider binds host:port
                                      Server.run() blocks and accepts connections
```

## AppComponent.hpp

This is the DI (dependency injection) container. In Express you'd just declare
things at the top of `app.ts`:

```
// Express
const pool = new Pool({ connectionString })
const app = express()
app.use(express.json())
```

In oatpp, each `OATPP_CREATE_COMPONENT(...)` macro registers a typed singleton.
Any class can then request it by type — like a built-in IoC container. You don't
pass objects around manually.

## DatabasePool

Same concept as `new Pool({ host, port, database, user, password })` from the
`pg` npm package. It manages a fixed number of connections and hands them out
on demand. When a connection is returned, it goes back to the pool — same as
`pool.connect()` / `client.release()` in Node.

## Key C++ Differences to Remember

1. **No garbage collector** — shared_ptr (reference-counted smart pointers) handle
   cleanup. When nothing points to an object, it's freed. Like React refs but for memory.

2. **Compile-time types** — DTOs are checked at build time, not runtime. A typo in
   a field name is a compiler error, not a runtime crash.

3. **Headers vs source files** — `.hpp` files declare the interface (like TypeScript
   `.d.ts` files), `.cpp` files contain the implementation. Some small classes live
   entirely in headers.

4. **`#pragma once`** — prevents a header from being included twice. Like making sure
   you don't `import` the same module twice (Node handles this automatically).

5. **`std::string` vs `oatpp::String`** — oatpp has its own string type for
   serialization. Convert between them when needed. Think of it like Buffer vs string
   in Node.

6. **`v_uint16`** — oatpp's typedef for unsigned 16-bit int (port numbers). Just a
   number, but typed more precisely than JS's `number`.
