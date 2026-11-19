// The entry `@polyspec/hyper/build` of the package: the rules of the Rust core that a build of an application applies,
// which the command tool `@polyspec/hyper-cli` calls (HY-48.3, HY-73.34, HY-125).
export {
  buildFileText,
  buildId,
  buildPaths,
  buildStream,
  readsFile,
  reservedTemplate,
  shellFile,
  templateProblems,
  type BuildOutput,
} from './app/build-rules.js';
