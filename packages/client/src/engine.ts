import { AstProgram, Engine, type HostFunction, type Loader } from '@polyspec/template/render';

// Creates a render-only engine that reads parsed templates (AST JSON) from a loader and registers the host functions of
// the application (HYC-24, template RT-5); an absent map registers none, and the engine fails a map that RT-5 refuses.
export function createEngine(loader: Loader, functions?: Record<string, HostFunction>): Engine {
  return new Engine(new AstProgram({ loader, functions }));
}
