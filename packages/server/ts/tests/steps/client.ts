// The steps of contracts/client.json (HY-62): one server answers the client-rendered and the server-rendered pages of the
// fixture manifest. PHP and Python pass the same cases.
import { maskedToken } from '../../src/csrf.js';
import type { CaseReader } from '../case-reader.js';
import { client, Fixture, parsed, record, TOKEN } from '../support.js';

// The representation handler of the client fixture is not wired into the test application yet (H28.7); the cases that
// state its calls or its request fail until it is.
const HANDLER_NOT_WIRED = 'the representation handler of the client fixture is not wired (H28.7)';

export const steps = {
  async cases(reader: CaseReader): Promise<void> {
    if (reader.has('handler') || reader.has('handled') || reader.has('received')) throw new Error(HANDLER_NOT_WIRED);
    const fixture = new Fixture();
    const headers = Object.fromEntries(reader.input('request.headers') as Map<string, string>);
    const method = reader.input('request.method') as string;
    const target = reader.input('request.target') as string;
    const form = reader.has('request.form') ? Object.fromEntries(reader.input('request.form') as Map<string, string>) : undefined;
    let fields = form;
    if (reader.has('request.csrf') && reader.input('request.csrf') === true) {
      fixture.session.set('_hyper_csrf', TOKEN);
      fields = { _csrf: maskedToken(TOKEN), ...fields };
    }
    const body = reader.has('request.body')
      ? (reader.input('request.body') as string)
      : fields === undefined ? undefined : new URLSearchParams(fields).toString();
    const response = await fixture.handle({ method, target, headers, body }, { clientRendering: client() });
    reader.compare('status', response.status);
    reader.compare('headers', response.headers);
    reader.compare('allHeaders', response.headers);
    reader.compare('body', response.body);
    reader.compare('absentHeaders', response.headers);
    if (reader.has('json')) {
      const json = record(parsed(response.body));
      reader.compare('json.route', json.route);
      reader.compare('json.params', json.params);
      reader.compare('json.regions', record(json.regions));
    }
    reader.compare('session', fixture.session.get('_hyper_csrf') !== undefined);
    reader.compare('actions', fixture.counter.actions);
  },
};
