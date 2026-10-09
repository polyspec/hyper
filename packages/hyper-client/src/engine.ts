import { AstProgram, Engine, type Loader } from '@polyspec/template/render';

// Creates a render-only engine that reads parsed templates (AST JSON) from a loader.
export function createEngine(loader: Loader): Engine {
  return new Engine(new AstProgram({ loader }));
}
