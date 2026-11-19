// The session store of one request of the Redis sessions (HY-24, HY-45, HY-72, HY-115): the record session of the Redis
// store of the session-store library, with the values of the data model as `FileSession` gives them.
import { FileSession } from './file-session.js';

/** @internal */
export class RedisSession extends FileSession {}
