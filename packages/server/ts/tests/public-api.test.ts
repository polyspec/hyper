import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

// The values that the package exports are the public API that HY-106 names, including the file class of HY-113.
describe('The public API', () => {
  it('is what the index exports (HY-106)', () => {
    expect(Object.keys(api).sort()).toEqual(['App', 'ArraySession', 'BadRequest', 'Choice', 'ClientRendering', 'Container', 'FileSession', 'FileSessions', 'Forbidden', 'MediaType', 'NotFound', 'RecordSession', 'Redirect', 'RedisSession', 'RedisSessions', 'Reply', 'Representation', 'Request', 'Response', 'Result', 'SessionLockError', 'UploadedFile']);
  });
});
