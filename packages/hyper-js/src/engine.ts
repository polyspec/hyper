import { AstProgram, Engine, type MapLoader } from '@polyspec/template/render';

// Creates a render-only engine that reads parsed templates (AST JSON) from a map loader.
export function createEngine(loader: MapLoader): Engine {
  return new Engine(new AstProgram({ loader }));
}
