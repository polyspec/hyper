// The client-rendered pages of an application (HY-62): their HTML requests receive the static shell, and their JSON
// requests and actions use the data base path.
import type { Choice } from './choice.js';
import type { Request } from './request.js';

export class ClientRendering {
  // The absolute path of the static shell, which declares the data base path with <meta name="hyper-api"> (HYC-8).
  readonly shell: string;
  // The data base path, such as /_props (HY-8).
  readonly basePath: string;
  // Returns the choice of a request, for example by its Host header, or a promise of it, which the server awaits.
  readonly selects: (request: Request) => Choice | Promise<Choice>;

  constructor(shell: string, basePath: string, selects: (request: Request) => Choice | Promise<Choice>) {
    this.shell = shell;
    this.basePath = basePath;
    this.selects = selects;
  }
}
