import { AstProgram, Engine, MapLoader, type Template } from '@polyspec/template/render';

// Creates a render-only engine from template names mapped to parsed templates (AST JSON).
export function createEngine(templates: Record<string, Template>): Engine {
  return new Engine(new AstProgram({ loader: new MapLoader(templates) }));
}
