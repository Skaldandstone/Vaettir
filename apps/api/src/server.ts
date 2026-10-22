// Default deployment entrypoint. No fixture flag is read from the environment.
// Application imports retain release validation, database resolution and tracing.
import { startApiServer } from "./serverApplication.js";

await startApiServer();
