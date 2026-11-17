// The steps of tests/legacy/file-store-sessions.json (HY-45, HY-104): the fixed copy of the store cases that the
// session-store library holds, which the server reads until S-4 removes the copy; the requests run as those of
// contracts/file-sessions.json. The options that the store refuses are the section `storeFailures` of
// contracts/file-sessions.json, which states the kinds of the library.
import type { CaseReader } from '../case-reader.js';
import { sessionFileRequests } from './file-sessions.js';

export const steps = {
  async requests(reader: CaseReader): Promise<void> {
    await sessionFileRequests(reader);
  },
};
